import { DOCUMENTS_ACTIVE_LIMIT_BYTES } from "./contracts.js";
import { createMemoryMutationReceipt, defineMemoryPlugin, defineMemorySource, installMemory, memoryConfigurationDigest, memoryInputRecord, memoryInputStringArray, memoryInputText, truncateMemoryText } from "dsh-mnemon/extension-sdk";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import z from "schemastery";
import { createHash, randomUUID } from "node:crypto";
import { COMPOSABLE_MEMORY_API_VERSION } from "dsh-mnemon/contracts";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
//#region src/config.ts
const Config = z.object({
	dataDir: z.string(),
	limitBytes: z.number().step(1).min(1).max(1073741824)
});
function documentsSourceConfig(value, instanceKey) {
	const config = Config(value);
	const dataDir = config.dataDir ?? join(homedir(), ".mnemon", "sources", encodeURIComponent(instanceKey));
	if (!isAbsolute(dataDir)) throw new Error("Documents Source dataDir must be absolute");
	return {
		dataDir,
		limitBytes: config.limitBytes ?? 10485760
	};
}
//#endregion
//#region src/search-tokens.ts
/** Small deterministic tokenizer shared by local Document and Native recovery. */
function lexicalSearchTokens(value, maximum = 64) {
	const normalized = value.normalize("NFKC").toLocaleLowerCase();
	const tokens = [];
	for (const segment of normalized.split(/(\p{Script=Han}+)/gu)) {
		if (/^\p{Script=Han}+$/u.test(segment)) {
			const characters = [...segment];
			if (characters.length <= 2) tokens.push(segment);
			else for (let index = 0; index < characters.length - 1; index += 1) tokens.push(`${characters[index]}${characters[index + 1]}`);
			continue;
		}
		tokens.push(...(segment.match(/[\p{L}\p{N}_-]+/gu) ?? []).filter((token) => token.length >= 2));
	}
	return [...new Set(tokens)].slice(0, maximum);
}
/** Require broader coverage only after a query is focused enough to support it. */
function lexicalRequiredMatchCount(tokens) {
	if (tokens.length === 0) return 0;
	if (tokens.length < 4) return 1;
	return Math.max(2, Math.ceil(tokens.length / 4));
}
//#endregion
//#region src/controller.ts
const MAX_DOCUMENT_BYTES = 2097152;
const LOCK_TIMEOUT_MS = 5e3;
const LOCK_STALE_MS = 3e4;
const LOCK_RETRY_MS = 20;
const MAX_EXCERPT_CACHE_ENTRIES = 2048;
var DocumentCapacityError = class extends Error {
	projected;
	limit;
	candidates;
	code = "document-capacity";
	constructor(projected, limit, candidates) {
		super(`Would exceed active document capacity: ${projected} bytes (limit ${limit}). Archive the least-recently-used active document before retrying.`);
		this.projected = projected;
		this.limit = limit;
		this.candidates = candidates;
		this.name = "DocumentCapacityError";
	}
};
var DocumentConflictError = class extends Error {
	code = "revision-conflict";
	constructor() {
		super("document changed while archival was running; the active copy was preserved");
		this.name = "DocumentConflictError";
	}
};
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeLine(value, field, maximum, required) {
	const normalized = value?.trim().replace(/\s+/gu, " ") ?? "";
	if (required && normalized === "") throw new Error(`${field} is required`);
	if (normalized.length > maximum) throw new Error(`${field} is too long (max ${maximum} characters)`);
	return normalized;
}
function normalizeContent(value, required) {
	if (value === void 0 && !required) return void 0;
	const normalized = value?.replace(/\0/gu, "").trim() ?? "";
	if (normalized === "") throw new Error("document content is required");
	const size = Buffer.byteLength(normalized, "utf8");
	if (size > MAX_DOCUMENT_BYTES) throw new Error(`document content is too large (${size} bytes; max ${MAX_DOCUMENT_BYTES})`);
	return normalized;
}
function unique(values, maximum) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
}
function hash(value) {
	return createHash("sha256").update(value).digest("hex");
}
function indexRevision(index) {
	return hash(JSON.stringify(index));
}
function copyIndex(index) {
	return {
		version: index.version,
		documents: index.documents.map((record) => ({
			...record,
			sourcePaths: [...record.sourcePaths],
			sessionIds: [...record.sessionIds],
			memoryBodyIds: [...record.memoryBodyIds]
		}))
	};
}
function slug(title) {
	return title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "document";
}
function yamlString(value) {
	return JSON.stringify(value);
}
function renderDocument(record, content) {
	const sources = record.sourcePaths.length === 0 ? "  []" : record.sourcePaths.map((path) => `  - ${yamlString(path)}`).join("\n");
	const sessions = record.sessionIds.length === 0 ? "  []" : record.sessionIds.map((id) => `  - ${yamlString(id)}`).join("\n");
	const bodies = record.memoryBodyIds.length === 0 ? "  []" : record.memoryBodyIds.map((id) => `  - ${yamlString(id)}`).join("\n");
	return `---
id: ${yamlString(record.id)}
title: ${yamlString(record.title)}
description: ${yamlString(record.description)}
status: ${yamlString(record.status)}
created_at: ${yamlString(record.createdAt)}
updated_at: ${yamlString(record.updatedAt)}
content_hash: ${yamlString(record.contentHash)}
source_paths:
${sources}
session_ids:
${sessions}
memory_body_ids:
${bodies}
---

${content.trim()}\n`;
}
function documentBody(markdown) {
	if (!markdown.startsWith("---\n")) return markdown.trim();
	const end = markdown.indexOf("\n---\n", 4);
	return end < 0 ? markdown.trim() : markdown.slice(end + 5).trim();
}
function excerpt(content, maximum = 220) {
	const normalized = content.replace(/[#>*_`\[\]]/gu, "").replace(/\s+/gu, " ").trim();
	return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}
/** Include ctime and identity so restored mtimes and atomic replacements miss. */
function diskIdentity(stat) {
	return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}`;
}
function sleepSync(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
function parseRecord(value) {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.description !== "string") return void 0;
	if (value.status !== "active" && value.status !== "archived" || typeof value.filename !== "string" || typeof value.relativePath !== "string") return void 0;
	if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || typeof value.lastAccessedAt !== "string") return void 0;
	if (typeof value.revision !== "number" || typeof value.contentHash !== "string" || typeof value.sizeBytes !== "number") return void 0;
	if (!Array.isArray(value.sourcePaths) || !Array.isArray(value.sessionIds) || !Array.isArray(value.memoryBodyIds)) return void 0;
	return {
		id: value.id,
		title: value.title,
		description: value.description,
		status: value.status,
		filename: value.filename,
		relativePath: value.relativePath,
		sourcePaths: value.sourcePaths.filter((entry) => typeof entry === "string"),
		sessionIds: value.sessionIds.filter((entry) => typeof entry === "string"),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		lastAccessedAt: value.lastAccessedAt,
		revision: value.revision,
		contentHash: value.contentHash,
		sizeBytes: value.sizeBytes,
		...typeof value.archivedAt === "string" ? { archivedAt: value.archivedAt } : {},
		...typeof value.archiveSummary === "string" ? { archiveSummary: value.archiveSummary } : {},
		memoryBodyIds: value.memoryBodyIds.filter((entry) => typeof entry === "string")
	};
}
/** Project-scoped control plane for managed active and cold document copies. */
var DocumentController = class {
	limitBytes;
	now;
	workspaceRoot;
	storageRoot;
	directory;
	activeDirectory;
	archivedDirectory;
	indexPath;
	lockPath;
	managedRelativePrefix;
	queue = Promise.resolve();
	excerpts = /* @__PURE__ */ new Map();
	indexCache;
	indexRevisions = /* @__PURE__ */ new WeakMap();
	constructor(workspaceRoot, limitBytes = DOCUMENTS_ACTIVE_LIMIT_BYTES, now = () => /* @__PURE__ */ new Date(), storageRoot) {
		this.limitBytes = limitBytes;
		this.now = now;
		this.workspaceRoot = resolve(workspaceRoot);
		if (!existsSync(this.workspaceRoot) || !statSync(this.workspaceRoot).isDirectory()) throw new Error(`document workspace is unavailable: ${this.workspaceRoot}`);
		if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) throw new Error("active document limit must be a positive integer");
		this.storageRoot = storageRoot === void 0 ? join(this.workspaceRoot, ".mnemon") : resolve(storageRoot);
		this.managedRelativePrefix = storageRoot === void 0 ? [".mnemon", "documents"].join("/") : "documents";
		this.directory = join(this.storageRoot, "documents");
		this.activeDirectory = join(this.directory, "active");
		this.archivedDirectory = join(this.directory, "archived");
		this.indexPath = join(this.directory, "index.json");
		this.lockPath = join(this.directory, ".index.lock");
		this.initialize();
	}
	snapshot() {
		return this.withLock(() => this.snapshotUnlocked(this.readIndex()));
	}
	/** Source facts and read-grant membership need metadata, not every document body. */
	catalog() {
		return this.withLock(() => this.snapshotUnlocked(this.readIndex(), false));
	}
	revision() {
		return this.withLock(() => this.revisionOf(this.readIndex()));
	}
	get(id) {
		return this.withLock(() => this.view(this.requireDocument(this.readIndex(), id)));
	}
	capacityPlan(request) {
		return this.withLock(() => {
			const index = this.readIndex();
			const active = index.documents.filter((record) => record.status === "active");
			const used = active.reduce((sum, record) => sum + record.sizeBytes, 0);
			let projected;
			let excludeId;
			if (request.action === "create") {
				const now = this.now().toISOString();
				const title = normalizeLine(request.title, "document title", 160, true);
				const content = normalizeContent(request.content, true);
				const id = crypto.randomUUID();
				const record = {
					id,
					title,
					description: normalizeLine(request.description, "document description", 600, false),
					status: "active",
					filename: `${slug(title)}-${id.slice(0, 8)}.md`,
					relativePath: "",
					sourcePaths: this.normalizeSourcePaths(request.sourcePaths ?? []),
					sessionIds: unique(request.sessionIds ?? [], 20),
					createdAt: now,
					updatedAt: now,
					lastAccessedAt: now,
					revision: 1,
					contentHash: hash(content),
					sizeBytes: 0,
					memoryBodyIds: []
				};
				projected = used + Buffer.byteLength(renderDocument(record, content), "utf8");
			} else {
				const current = this.requireDocument(index, request.id);
				if (current.status !== "active") throw new Error("archived documents are immutable; create a new active revision instead");
				const content = normalizeContent(request.content, false) ?? this.readBody(current);
				const updated = {
					...current,
					title: request.title === void 0 ? current.title : normalizeLine(request.title, "document title", 160, true),
					description: request.description === void 0 ? current.description : normalizeLine(request.description, "document description", 600, false),
					sourcePaths: request.sourcePaths === void 0 ? current.sourcePaths : this.normalizeSourcePaths(request.sourcePaths),
					sessionIds: request.sessionIds === void 0 ? current.sessionIds : unique([...current.sessionIds, ...request.sessionIds], 20),
					contentHash: hash(content),
					revision: current.revision + 1
				};
				projected = used - current.sizeBytes + Buffer.byteLength(renderDocument(updated, content), "utf8");
				excludeId = current.id;
			}
			const candidates = active.filter((record) => record.id !== excludeId).sort((left, right) => Date.parse(left.lastAccessedAt) - Date.parse(right.lastAccessedAt) || Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
			return {
				projected,
				limit: this.limitBytes,
				fits: projected <= this.limitBytes,
				candidates
			};
		});
	}
	search(query, options = {}) {
		const operation = this.queue.then(() => this.withLock(() => {
			const index = this.readIndex();
			const normalized = query.trim().normalize("NFKC").toLocaleLowerCase();
			const tokens = lexicalSearchTokens(normalized);
			const requiredTokenMatches = lexicalRequiredMatchCount(tokens);
			const includeArchived = options.includeArchived === true;
			const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)));
			const allowedIds = options.allowedIds === void 0 ? void 0 : new Set(options.allowedIds);
			const ranked = index.documents.filter((record) => allowedIds === void 0 || allowedIds.has(record.id)).filter((record) => includeArchived || record.status === "active").map((record) => {
				const view = this.view(record);
				const title = view.title.normalize("NFKC").toLocaleLowerCase();
				const description = view.description.normalize("NFKC").toLocaleLowerCase();
				const content = view.content.normalize("NFKC").toLocaleLowerCase();
				let score = normalized === "" ? 1 : title.includes(normalized) ? 12 : description.includes(normalized) ? 7 : content.includes(normalized) ? 4 : 0;
				let tokenMatches = 0;
				for (const token of tokens) {
					const titleMatch = title.includes(token);
					const descriptionMatch = description.includes(token);
					const contentMatch = content.includes(token);
					if (titleMatch || descriptionMatch || contentMatch) tokenMatches += 1;
					score += titleMatch ? 4 : descriptionMatch ? 2 : contentMatch ? 1 : 0;
				}
				return {
					result: {
						...view,
						score,
						excerpt: excerpt(view.content)
					},
					tokenMatches
				};
			}).filter((candidate) => normalized === "" || candidate.result.score > 0 && candidate.tokenMatches >= requiredTokenMatches).sort((left, right) => right.result.score - left.result.score || Date.parse(right.result.updatedAt) - Date.parse(left.result.updatedAt)).slice(0, limit).map((candidate) => candidate.result);
			if (ranked.length > 0) {
				const accessedAt = this.now().toISOString();
				const ids = new Set(ranked.map((result) => result.id));
				index.documents = index.documents.map((record) => ids.has(record.id) ? {
					...record,
					lastAccessedAt: accessedAt
				} : record);
				this.persistIndex(index);
			}
			return {
				query: query.trim(),
				includeArchived,
				total: ranked.length,
				generatedAt: this.now().toISOString(),
				results: ranked
			};
		}));
		this.queue = operation.catch(() => void 0);
		return operation;
	}
	mutate(request, expectedRevision) {
		const operation = this.queue.then(() => this.withLock(() => this.mutateLocked(request, expectedRevision)));
		this.queue = operation.catch(() => void 0);
		return operation;
	}
	archive(id, expectedRevision, details) {
		const operation = this.queue.then(() => this.withLock(() => {
			const index = this.readIndex();
			const current = this.requireDocument(index, id);
			if (current.status !== "active") throw new Error("only active documents can be archived");
			if (current.revision !== expectedRevision) throw new DocumentConflictError();
			const source = this.pathFor(current);
			const now = this.now().toISOString();
			const updated = {
				...current,
				status: "archived",
				relativePath: this.relativeManagedPath("archived", current.filename),
				updatedAt: now,
				lastAccessedAt: now,
				revision: current.revision + 1,
				archivedAt: now,
				archiveSummary: normalizeLine(details.summary, "archive summary", 1e3, true),
				memoryBodyIds: unique(details.memoryBodyIds, 20)
			};
			const content = this.readBody(current);
			const rendered = renderDocument(updated, content);
			updated.sizeBytes = Buffer.byteLength(rendered, "utf8");
			const destination = this.pathFor(updated);
			renameSync(source, destination);
			try {
				writeFileSync(destination, rendered, "utf8");
				index.documents = index.documents.map((record) => record.id === id ? updated : record);
				this.persistIndex(index);
			} catch (error) {
				if (existsSync(destination)) renameSync(destination, source);
				throw error;
			}
			return {
				success: true,
				action: "archived",
				document: {
					...updated,
					content
				},
				snapshot: this.snapshotUnlocked(index)
			};
		}));
		this.queue = operation.catch(() => void 0);
		return operation;
	}
	mutateLocked(request, expectedRevision) {
		const index = this.readIndex();
		if (expectedRevision !== void 0 && this.revisionOf(index) !== expectedRevision) throw new DocumentConflictError();
		const now = this.now().toISOString();
		if (request.action === "create") {
			const title = normalizeLine(request.title, "document title", 160, true);
			const description = normalizeLine(request.description, "document description", 600, false);
			const content = normalizeContent(request.content, true);
			const id = crypto.randomUUID();
			const filename = `${slug(title)}-${id.slice(0, 8)}.md`;
			const record = {
				id,
				title,
				description,
				status: "active",
				filename,
				relativePath: this.relativeManagedPath("active", filename),
				sourcePaths: this.normalizeSourcePaths(request.sourcePaths ?? []),
				sessionIds: unique(request.sessionIds ?? [], 20),
				createdAt: now,
				updatedAt: now,
				lastAccessedAt: now,
				revision: 1,
				contentHash: hash(content),
				sizeBytes: 0,
				memoryBodyIds: []
			};
			const rendered = renderDocument(record, content);
			record.sizeBytes = Buffer.byteLength(rendered, "utf8");
			this.assertCapacity(index, record.sizeBytes);
			this.persistDocument(record, content);
			index.documents.push(record);
			this.persistIndex(index);
			return {
				success: true,
				action: "created",
				document: {
					...record,
					content
				},
				snapshot: this.snapshotUnlocked(index)
			};
		}
		const current = this.requireDocument(index, request.id);
		if (current.status !== "active") throw new Error("archived documents are immutable; create a new active revision instead");
		const content = normalizeContent(request.content, false) ?? this.readBody(current);
		const updated = {
			...current,
			title: request.title === void 0 ? current.title : normalizeLine(request.title, "document title", 160, true),
			description: request.description === void 0 ? current.description : normalizeLine(request.description, "document description", 600, false),
			sourcePaths: request.sourcePaths === void 0 ? current.sourcePaths : this.normalizeSourcePaths(request.sourcePaths),
			sessionIds: request.sessionIds === void 0 ? current.sessionIds : unique([...current.sessionIds, ...request.sessionIds], 20),
			updatedAt: now,
			lastAccessedAt: now,
			revision: current.revision + 1,
			contentHash: hash(content)
		};
		const rendered = renderDocument(updated, content);
		updated.sizeBytes = Buffer.byteLength(rendered, "utf8");
		this.assertCapacity(index, updated.sizeBytes - current.sizeBytes, current.id);
		this.persistDocument(updated, content);
		index.documents = index.documents.map((record) => record.id === current.id ? updated : record);
		this.persistIndex(index);
		return {
			success: true,
			action: "updated",
			document: {
				...updated,
				content
			},
			snapshot: this.snapshotUnlocked(index)
		};
	}
	initialize() {
		mkdirSync(this.activeDirectory, { recursive: true });
		mkdirSync(this.archivedDirectory, { recursive: true });
		if (!existsSync(this.indexPath)) this.atomicWrite(this.indexPath, `${JSON.stringify({
			version: 1,
			documents: []
		}, null, 2)}\n`);
		this.readIndex();
	}
	readIndex() {
		const identity = diskIdentity(statSync(this.indexPath, { bigint: true }));
		if (this.indexCache?.identity === identity) {
			const index = copyIndex(this.indexCache.index);
			this.indexRevisions.set(index, this.indexCache.revision);
			return index;
		}
		this.indexCache = void 0;
		const raw = JSON.parse(readFileSync(this.indexPath, "utf8"));
		if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.documents)) throw new Error(`invalid document index: ${this.indexPath}`);
		const documents = raw.documents.map(parseRecord);
		if (documents.some((record) => record === void 0)) throw new Error(`invalid document record in ${this.indexPath}`);
		const index = {
			version: 1,
			documents
		};
		const revision = indexRevision(index);
		this.indexRevisions.set(index, revision);
		try {
			if (diskIdentity(statSync(this.indexPath, { bigint: true })) === identity) this.indexCache = {
				identity,
				index: copyIndex(index),
				revision
			};
		} catch {}
		return index;
	}
	revisionOf(index) {
		return this.indexRevisions.get(index) ?? indexRevision(index);
	}
	snapshotUnlocked(index, includeExcerpts = true) {
		const cachedPaths = includeExcerpts ? index.documents.slice(0, MAX_EXCERPT_CACHE_ENTRIES).map((record) => this.pathFor(record)) : void 0;
		const eligiblePaths = cachedPaths === void 0 ? void 0 : new Set(cachedPaths);
		if (eligiblePaths !== void 0) {
			for (const path of this.excerpts.keys()) if (!eligiblePaths.has(path)) this.excerpts.delete(path);
		}
		const documents = index.documents.map((record, position) => {
			const path = cachedPaths?.[position] ?? this.pathFor(record);
			let stat;
			try {
				stat = statSync(path, { bigint: true });
			} catch {
				this.excerpts.delete(path);
				return {
					...record,
					healthy: false,
					excerpt: ""
				};
			}
			return {
				...record,
				healthy: true,
				excerpt: includeExcerpts ? this.bodyExcerpt(record, path, stat, eligiblePaths.has(path)) : ""
			};
		});
		const active = documents.filter((record) => record.status === "active");
		return {
			workspaceRoot: this.workspaceRoot,
			directory: this.directory,
			indexPath: this.indexPath,
			generatedAt: this.now().toISOString(),
			revision: this.revisionOf(index),
			limitBytes: this.limitBytes,
			activeBytes: active.reduce((sum, record) => sum + record.sizeBytes, 0),
			activeCount: active.length,
			archivedCount: documents.length - active.length,
			total: documents.length,
			documents
		};
	}
	/** Cache only presentation excerpts; reads/search and each health check stay live. */
	bodyExcerpt(record, path, stat, cacheable) {
		if (!cacheable) return excerpt(this.readBody(record));
		const identity = diskIdentity(stat);
		const cached = this.excerpts.get(path);
		if (cached?.identity === identity) return cached.value;
		this.excerpts.delete(path);
		const value = excerpt(this.readBody(record));
		try {
			if (diskIdentity(statSync(path, { bigint: true })) === identity) this.excerpts.set(path, {
				identity,
				value
			});
		} catch {}
		return value;
	}
	requireDocument(index, rawId) {
		const id = rawId.trim();
		const record = index.documents.find((document) => document.id === id);
		if (record === void 0) throw new Error(`document not found: ${id}`);
		return record;
	}
	assertCapacity(index, delta, excludeId) {
		const active = index.documents.filter((record) => record.status === "active");
		const projected = active.reduce((sum, record) => sum + record.sizeBytes, 0) + delta;
		if (projected <= this.limitBytes) return;
		const candidates = active.filter((record) => record.id !== excludeId).sort((left, right) => Date.parse(left.lastAccessedAt) - Date.parse(right.lastAccessedAt) || Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
		throw new DocumentCapacityError(projected, this.limitBytes, candidates);
	}
	normalizeSourcePaths(paths) {
		return unique(paths, 50).map((value) => {
			const absolute = resolve(this.workspaceRoot, value);
			const workspaceRelative = relative(this.workspaceRoot, absolute);
			if (workspaceRelative === ".." || workspaceRelative.startsWith(`..${sep}`) || isAbsolute(workspaceRelative)) throw new Error(`source path must stay inside the workspace: ${value}`);
			if (absolute === this.directory || absolute.startsWith(`${this.directory}${sep}`)) throw new Error("managed document paths cannot be used as source paths");
			return workspaceRelative.split(sep).join("/") || ".";
		});
	}
	relativeManagedPath(status, filename) {
		return [
			this.managedRelativePrefix,
			status,
			basename(filename)
		].join("/");
	}
	pathFor(record) {
		const legacyPrefix = [".mnemon", "documents"].join("/");
		const relativePath = record.relativePath === legacyPrefix || record.relativePath.startsWith(`${legacyPrefix}/`) ? record.relativePath.slice(8) : record.relativePath;
		const path = resolve(this.storageRoot, relativePath);
		const managedRoot = `${resolve(this.directory)}${sep}`;
		if (!path.startsWith(managedRoot)) throw new Error("document index contains an unsafe managed path");
		return path;
	}
	readBody(record) {
		return documentBody(readFileSync(this.pathFor(record), "utf8"));
	}
	view(record) {
		return {
			...record,
			content: this.readBody(record)
		};
	}
	persistDocument(record, content) {
		this.atomicWrite(this.pathFor(record), renderDocument(record, content));
	}
	persistIndex(index) {
		this.indexCache = void 0;
		this.indexRevisions.delete(index);
		this.atomicWrite(this.indexPath, `${JSON.stringify(index, null, 2)}\n`);
	}
	atomicWrite(path, content) {
		const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
		writeFileSync(temporary, content, {
			encoding: "utf8",
			mode: 384
		});
		renameSync(temporary, path);
	}
	withLock(callback) {
		const deadline = Date.now() + LOCK_TIMEOUT_MS;
		let descriptor;
		while (descriptor === void 0) try {
			descriptor = openSync(this.lockPath, "wx", 384);
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS) rmSync(this.lockPath, { force: true });
			} catch {}
			if (Date.now() >= deadline) throw new Error(`timed out waiting for document lock: ${this.lockPath}`);
			sleepSync(LOCK_RETRY_MS);
		}
		try {
			return callback();
		} finally {
			closeSync(descriptor);
			rmSync(this.lockPath, { force: true });
		}
	}
};
/** Resolves one cached controller per canonical DSH workspace. */
var DocumentManager = class {
	limitBytes;
	now;
	storageRoot;
	controllers = /* @__PURE__ */ new Map();
	constructor(limitBytes = DOCUMENTS_ACTIVE_LIMIT_BYTES, now = () => /* @__PURE__ */ new Date(), storageRoot) {
		this.limitBytes = limitBytes;
		this.now = now;
		this.storageRoot = storageRoot;
	}
	forWorkspace(workspaceRoot) {
		const root = resolve(workspaceRoot);
		const storageRoot = this.storageRoot?.();
		const key = storageRoot === void 0 ? root : `${resolve(storageRoot)}\0${root}`;
		let controller = this.controllers.get(key);
		if (controller === void 0) {
			controller = new DocumentController(root, this.limitBytes, this.now, storageRoot);
			this.controllers.set(key, controller);
		}
		return controller;
	}
	forAgent(agent) {
		const cwd = agent.session.header?.cwd;
		if (cwd === void 0 || cwd.trim() === "") throw new Error("the current DSH session has no workspace for Mnemon Documents");
		return this.forWorkspace(cwd);
	}
};
//#endregion
//#region src/evidence.ts
/** Preserve query-local evidence under the Source's per-document budget. */
function documentEvidence(content, query, maximum) {
	if (maximum <= 0) return "";
	if (content.length <= maximum) return content;
	const normalized = content.toLocaleLowerCase();
	const matched = [query.trim(), ...query.match(/[\p{L}\p{N}_-]+/gu) ?? []].map((term) => term.toLocaleLowerCase()).filter(Boolean).sort((left, right) => right.length - left.length).map((term) => normalized.indexOf(term)).find((index) => index >= 0) ?? 0;
	const projectedStart = Math.max(0, Math.min(content.length - maximum, matched - 400));
	const prefix = projectedStart === 0 ? "" : "[earlier content omitted]\n";
	const suffix = projectedStart + maximum >= content.length ? "" : "\n[later content omitted]";
	if (maximum <= prefix.length + suffix.length) return truncateMemoryText(content.slice(matched), maximum);
	const bodyLength = maximum - prefix.length - suffix.length;
	let start = suffix === "" ? content.length - bodyLength : projectedStart;
	if (/[\uDC00-\uDFFF]/u.test(content[start])) start++;
	let end = Math.min(content.length, start + bodyLength);
	if (/[\uD800-\uDBFF]/u.test(content[end - 1])) end--;
	return `${prefix}${content.slice(start, end)}${suffix}`;
}
//#endregion
//#region src/source.ts
function workspace(scope) {
	const value = scope.workspaceId?.trim();
	return value === void 0 || value === "" ? void 0 : value;
}
function grantIds(grant, includeArchived = false) {
	const value = memoryInputRecord(grant.value, "Documents ReadGrant");
	return [...memoryInputStringArray(value.documentIds, "documentIds", 1e4) ?? [], ...includeArchived ? memoryInputStringArray(value.archivedDocumentIds, "archivedDocumentIds", 1e4) ?? [] : []];
}
const CREATE_PROPERTIES = {
	title: { type: "string" },
	description: { type: "string" },
	content: { type: "string" },
	sourcePaths: { type: "array" },
	sessionIds: { type: "array" }
};
function documentCreation(value) {
	const input = memoryInputRecord(value, "Documents create");
	for (const key of Object.keys(input)) if (!Object.hasOwn(CREATE_PROPERTIES, key)) throw new Error("unsupported Documents create field: " + key);
	return documentMutation({
		...input,
		action: "create"
	});
}
function documentMutation(value, allowedIds) {
	const input = memoryInputRecord(value, "Documents mutation");
	const action = memoryInputText(input.action, "action", 20);
	let mutation;
	if (action === "create") mutation = {
		action,
		title: memoryInputText(input.title, "title", 160),
		content: memoryInputText(input.content, "content", 1e6),
		...memoryInputText(input.description, "description", 600, false) === void 0 ? {} : { description: memoryInputText(input.description, "description", 600, false) },
		...input.sourcePaths === void 0 ? {} : { sourcePaths: memoryInputStringArray(input.sourcePaths, "sourcePaths") ?? [] },
		...input.sessionIds === void 0 ? {} : { sessionIds: memoryInputStringArray(input.sessionIds, "sessionIds", 20) ?? [] }
	};
	else if (action === "update") {
		const id = memoryInputText(input.id, "id", 300);
		if (allowedIds !== void 0 && !allowedIds.includes(id)) throw new Error("Documents update target is outside this View ReadGrant");
		mutation = {
			action,
			id,
			...memoryInputText(input.title, "title", 160, false) === void 0 ? {} : { title: memoryInputText(input.title, "title", 160, false) },
			...memoryInputText(input.description, "description", 600, false) === void 0 ? {} : { description: memoryInputText(input.description, "description", 600, false) },
			...memoryInputText(input.content, "content", 1e6, false) === void 0 ? {} : { content: memoryInputText(input.content, "content", 1e6, false) },
			...input.sourcePaths === void 0 ? {} : { sourcePaths: memoryInputStringArray(input.sourcePaths, "sourcePaths") ?? [] },
			...input.sessionIds === void 0 ? {} : { sessionIds: memoryInputStringArray(input.sessionIds, "sessionIds", 20) ?? [] }
		};
	} else throw new Error(`unsupported Documents action: ${action}`);
	return mutation;
}
function createDocumentsMemorySource(config = {}) {
	const configured = Object.freeze({ ...config });
	return defineMemorySource({
		manifest: {
			apiVersion: COMPOSABLE_MEMORY_API_VERSION,
			kind: "source",
			typeId: "documents",
			packageName: "dsh-mnemon-source-documents",
			role: "narrative",
			capabilities: [
				"status",
				"project",
				"search",
				"read",
				"write"
			],
			consistency: "namespace-pinned-live-read",
			routes: [{
				id: "search",
				description: "Search only the project Documents pinned into this View.",
				capability: "search",
				inputSchema: {
					type: "object",
					required: ["query"],
					additionalProperties: false,
					properties: {
						query: { type: "string" },
						limit: { type: "integer" },
						includeArchived: { type: "boolean" }
					}
				},
				maxCalls: 4,
				maxResults: 20,
				maxCharacters: 16e3
			}],
			actions: [{
				id: "manage",
				description: "Create a project Document or update a Document pinned into this View.",
				capability: "write",
				inputSchema: {
					type: "object",
					required: ["action"],
					additionalProperties: false,
					properties: {
						action: {
							type: "string",
							enum: ["create", "update"]
						},
						id: { type: "string" },
						...CREATE_PROPERTIES
					}
				}
			}, {
				id: "create",
				description: "Create one new project Document without updating or archiving existing documents. Capacity exhaustion rejects the write.",
				capability: "write",
				inputSchema: {
					type: "object",
					required: ["title", "content"],
					additionalProperties: false,
					properties: CREATE_PROPERTIES
				}
			}],
			management: {
				label: "Project Documents",
				description: "Workspace-scoped narrative memory with namespace-pinned reads."
			}
		},
		create(context) {
			const effective = documentsSourceConfig({
				...context.configuration,
				...configured
			}, context.sourceInstanceKey);
			const documents = new DocumentManager(effective.limitBytes, void 0, () => effective.dataDir);
			const snapshot = (workspaceId) => workspaceId === void 0 ? void 0 : documents.forWorkspace(workspaceId).catalog();
			const prepared = /* @__PURE__ */ new WeakMap();
			return {
				facts(request) {
					const root = workspace(request.scope);
					if (root === void 0) return {
						sourceInstanceKey: context.sourceInstanceKey,
						sourceTypeId: "documents",
						role: "narrative",
						availability: "unavailable",
						revision: "unavailable:no-workspace",
						capabilities: ["status"],
						routeIds: [],
						actionIds: [],
						hints: { reason: "no-workspace" }
					};
					if (request.scenario.startsWith("management.") && request.scenario !== "management.catalog") return {
						sourceInstanceKey: context.sourceInstanceKey,
						sourceTypeId: "documents",
						role: "narrative",
						availability: "ready",
						revision: documents.forWorkspace(root).revision(),
						capabilities: [
							"status",
							"project",
							"search",
							"read",
							"write"
						],
						routeIds: ["search"],
						actionIds: ["manage", "create"]
					};
					const current = snapshot(root);
					prepared.set(request.scope, current);
					const active = current.documents.filter((document) => document.status === "active" && document.healthy);
					return {
						sourceInstanceKey: context.sourceInstanceKey,
						sourceTypeId: "documents",
						role: "narrative",
						availability: "ready",
						revision: current.revision,
						capabilities: [
							"status",
							"project",
							"search",
							"read",
							"write"
						],
						routeIds: ["search"],
						actionIds: ["manage", "create"],
						hints: { activeCount: active.length }
					};
				},
				project(request) {
					const root = workspace(request.scope);
					if (root === void 0) return { fragments: [] };
					const current = prepared.get(request.scope) ?? snapshot(root);
					prepared.delete(request.scope);
					if (current.revision !== request.expectedRevision) throw new Error("Documents projection revision changed during composition");
					const active = current.documents.filter((document) => document.status === "active" && document.healthy).sort((a, b) => a.id.localeCompare(b.id));
					const readGrant = {
						id: `${context.sourceInstanceKey}/grant/${current.revision}`,
						sourceInstanceKey: context.sourceInstanceKey,
						schema: "dsh-mnemon.documents/v1",
						value: {
							workspaceRoot: root,
							documentIds: active.map((document) => document.id),
							archivedDocumentIds: current.documents.filter((document) => document.status === "archived" && document.healthy).map((document) => document.id).sort()
						},
						revision: current.revision,
						consistency: "namespace-pinned-live-read"
					};
					return {
						fragments: request.includeProjection ? [{
							id: `${context.sourceInstanceKey}/projection`,
							sourceInstanceKey: context.sourceInstanceKey,
							mode: request.mode,
							text: truncateMemoryText(`${active.length} active project Document${active.length === 1 ? "" : "s"} available through the documents/search route.`, request.maxCharacters),
							revision: current.revision,
							provenance: { sourceTypeId: "documents" }
						}] : [],
						readGrant,
						presentation: {
							visibleItems: active.length,
							totalItems: current.documents.length,
							items: [...active].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id)).slice(0, 24).map((document) => ({
								id: document.id,
								title: truncateMemoryText(document.title, 160),
								...(document.description || document.excerpt).trim() === "" ? {} : { excerpt: truncateMemoryText(document.description || document.excerpt, 600) }
							}))
						}
					};
				},
				async query(request) {
					const root = workspace(request.view.scope);
					if (root === void 0) throw new Error("Documents Route requires a workspace-scoped View");
					const input = memoryInputRecord(request.input, "Documents search");
					const query = memoryInputText(input.query, "query", 2e3, false) ?? "";
					const limitValue = input.limit;
					const limit = Math.min(request.route.maxResults ?? 20, typeof limitValue === "number" && Number.isInteger(limitValue) ? Math.max(1, Math.min(20, limitValue)) : 10);
					const controller = documents.forWorkspace(root);
					const allowedIds = grantIds(request.grant, input.includeArchived === true);
					const result = await controller.search(query, {
						limit,
						allowedIds,
						includeArchived: input.includeArchived === true
					});
					const suggestions = result.results.length === 0 && query !== "" ? controller.snapshot().documents.filter((document) => allowedIds.includes(document.id) && (input.includeArchived === true || document.status === "active")).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, Math.min(3, limit)) : [];
					let remaining = request.route.maxCharacters ?? 16e3;
					const items = [];
					let truncated = result.total > limit;
					for (const document of result.results) {
						if (remaining <= 0) {
							truncated = true;
							break;
						}
						const content = documentEvidence(document.content, query, Math.min(2600, remaining));
						remaining -= content.length;
						truncated ||= content !== document.content;
						items.push({
							id: document.id,
							text: content,
							score: document.score,
							revision: String(document.revision),
							provenance: {
								kind: "match",
								documentId: document.id,
								title: document.title,
								description: document.description,
								status: document.status,
								relativePath: document.relativePath,
								sourcePaths: document.sourcePaths.slice(0, 8)
							}
						});
					}
					for (const document of suggestions) {
						if (remaining <= 0) {
							truncated = true;
							break;
						}
						const excerpt = truncateMemoryText(document.excerpt, Math.min(1e3, remaining));
						remaining -= excerpt.length;
						items.push({
							id: document.id,
							score: 0,
							text: excerpt,
							provenance: {
								kind: "suggestion",
								documentId: document.id,
								title: document.title,
								description: document.description,
								status: document.status
							}
						});
					}
					return {
						metadata: {
							query: result.query,
							includeArchived: result.includeArchived,
							total: result.total
						},
						id: `evidence:${randomUUID()}`,
						viewId: request.view.id,
						routeId: request.route.id,
						sourceInstanceKey: context.sourceInstanceKey,
						observedAt: (/* @__PURE__ */ new Date()).toISOString(),
						truncated,
						items
					};
				},
				async manage(request) {
					const root = workspace(request.scope);
					if (root === void 0) throw new Error("Documents management requires a workspace");
					const controller = documents.forWorkspace(root);
					const input = request.input === null ? {} : memoryInputRecord(request.input, "Documents management");
					let value;
					if (request.mode === "read") switch (request.operation) {
						case "snapshot":
							value = controller.snapshot();
							break;
						case "document":
							value = controller.get(memoryInputText(input.id, "id", 300));
							break;
						case "capacity-plan":
							value = controller.capacityPlan(documentMutation(request.input));
							break;
						case "search":
							value = await controller.search(memoryInputText(input.query, "query", 2e3, false) ?? "", {
								includeArchived: input.includeArchived === true,
								...input.limit === void 0 ? {} : { limit: Math.min(100, Math.max(1, Number(input.limit) || 50)) }
							});
							break;
						default: throw new Error("unsupported Documents management read operation: " + request.operation);
					}
					else {
						if (!request.confirmed) throw new Error("Documents management mutation requires explicit confirmation");
						if (request.operation === "mutate") value = await controller.mutate(documentMutation(request.input), request.expectedRevision);
						else if (request.operation === "archive") {
							const document = controller.get(memoryInputText(input.id, "id", 300));
							const revision = input.documentRevision === void 0 ? document.revision : input.documentRevision;
							if (typeof revision !== "number" || !Number.isInteger(revision)) throw new Error("documentRevision must be an integer");
							value = await controller.archive(document.id, revision, {
								summary: memoryInputText(input.summary, "summary", 1e4, false) ?? "Archived locally by the user.",
								memoryBodyIds: memoryInputStringArray(input.memoryBodyIds, "memoryBodyIds", 100) ?? []
							});
						} else throw new Error("unsupported Documents management mutation operation: " + request.operation);
					}
					const completed = value;
					return {
						revision: completed.snapshot?.revision ?? (typeof completed.revision === "string" ? completed.revision : controller.revision()),
						value
					};
				},
				async mutate(request) {
					const root = workspace(request.view.scope);
					if (root === void 0) throw new Error("Documents Action requires a workspace-scoped View");
					const grant = request.grant;
					const mutation = request.offer.sourceActionId === "create" ? documentCreation(request.input) : documentMutation(request.input, grant === void 0 ? [] : grantIds(grant));
					const result = await documents.forWorkspace(root).mutate(mutation);
					return createMemoryMutationReceipt(request.view.id, request.offer.id, context.sourceInstanceKey, result.snapshot.revision, result, "committed");
				}
			};
		}
	});
}
const DOCUMENTS_MEMORY_SOURCE = createDocumentsMemorySource();
//#endregion
//#region src/index.ts
const name = "dsh-mnemon-source-documents";
const inject = ["mnemonMemory"];
const memoryPlugin = defineMemoryPlugin({
	packageName: name,
	label: {
		en: "Documents",
		"zh-CN": "档案"
	},
	description: {
		en: "Searchable project records and narrative memory.",
		"zh-CN": "可检索的项目档案与叙事记忆。"
	},
	roles: ["source"],
	provides: [{ id: "source" }, { id: "source.narrative" }]
});
function apply(ctx, config = {}) {
	installMemory(ctx, {
		plugin: memoryPlugin,
		sources: [createDocumentsMemorySource(config)]
	}, { effectiveDigest: memoryConfigurationDigest(config) });
}
//#endregion
export { Config, DOCUMENTS_MEMORY_SOURCE, apply, createDocumentsMemorySource, inject, memoryPlugin, name };
