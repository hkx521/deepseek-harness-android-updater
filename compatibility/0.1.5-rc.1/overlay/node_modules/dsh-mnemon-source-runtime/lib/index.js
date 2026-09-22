import { n as RUNTIME_MEMORY_LIMITS, o as MAX_RUNTIME_MEMORY_LIMIT_BYTES, t as RUNTIME_ENTRY_DELIMITER } from "./contracts-BqaPCrGD.js";
import { createMemoryMutationReceipt, defineMemoryPlugin, defineMemorySource, installMemory, memoryConfigurationDigest, memoryInputRecord, memoryInputStringArray, memoryInputText, truncateMemoryText } from "dsh-mnemon/extension-sdk";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import z from "schemastery";
import { COMPOSABLE_MEMORY_API_VERSION } from "dsh-mnemon/contracts";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
//#region src/config.ts
const Config = z.object({
	dataDir: z.string(),
	userDataDir: z.string(),
	memoryLimitBytes: z.number().step(1).min(1).max(MAX_RUNTIME_MEMORY_LIMIT_BYTES),
	userLimitBytes: z.number().step(1).min(1).max(MAX_RUNTIME_MEMORY_LIMIT_BYTES)
});
function runtimeSourceConfig(value, instanceKey) {
	const config = Config(value);
	const dataDir = config.dataDir ?? join(homedir(), ".mnemon", "sources", encodeURIComponent(instanceKey));
	const userDataDir = config.userDataDir ?? dataDir;
	if (!isAbsolute(dataDir) || !isAbsolute(userDataDir)) throw new Error("Runtime Source dataDir and userDataDir must be absolute");
	return {
		dataDir,
		userDataDir,
		memoryLimitBytes: config.memoryLimitBytes ?? 10240,
		userLimitBytes: config.userLimitBytes ?? 4096
	};
}
//#endregion
//#region src/git-branch.ts
const GIT_BRANCH_TIMEOUT_MS = 2e3;
/**
* Resolve the current git branch of a workspace root. Returns undefined when
* the directory is not a git working tree, HEAD is detached, or the probe
* fails or times out, so callers fall back to the unfiltered view.
*/
function resolveGitBranch(cwd) {
	const root = cwd?.trim();
	if (root === void 0 || root === "") return void 0;
	try {
		const branch = execFileSync("git", [
			"-C",
			root,
			"branch",
			"--show-current"
		], {
			encoding: "utf8",
			timeout: GIT_BRANCH_TIMEOUT_MS,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).trim();
		return branch === "" ? void 0 : branch;
	} catch {
		return;
	}
}
//#endregion
//#region src/controller.ts
const LOCK_TIMEOUT_MS = 5e3;
const LOCK_STALE_MS = 3e4;
const LOCK_RETRY_MS = 20;
const MAX_ENTRY_BYTES = 8192;
var RuntimeMemoryCapacityError = class extends Error {
	target;
	used;
	projected;
	limit;
	code = "runtime-capacity";
	constructor(target, used, projected, limit) {
		super(`Would exceed ${target} runtime memory capacity: ${projected} bytes (current ${used}, limit ${limit}). Archive and compact runtime memory before retrying.`);
		this.target = target;
		this.used = used;
		this.projected = projected;
		this.limit = limit;
		this.name = "RuntimeMemoryCapacityError";
	}
};
var RuntimeMemoryConflictError = class extends Error {
	code = "revision-conflict";
	constructor() {
		super("runtime memory changed while archival was running; no compacted data was applied");
		this.name = "RuntimeMemoryConflictError";
	}
};
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isTarget(value) {
	return value === "memory" || value === "user";
}
function isImportance(value) {
	return value === "critical" || value === "normal" || value === "low";
}
const RUNTIME_BRANCH_NAME_RE = /^[A-Za-z0-9._/-]+$/u;
/** Validate a model-supplied branch scope. Returns the normalized list; an empty list means "no scope". */
function normalizeRuntimeBranches(value, field = "branches") {
	if (!Array.isArray(value)) throw new Error(`${field} must be an array of git branch names`);
	const branches = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of value) {
		if (typeof item !== "string") throw new Error(`${field} must contain only git branch names`);
		const branch = item.trim();
		if (branch === "" || branch.length > 128 || !RUNTIME_BRANCH_NAME_RE.test(branch) || branch === "-" || branch.startsWith("/") || branch.startsWith("-") || branch.endsWith("/") || branch.endsWith(".") || branch.includes("..") || branch.includes("//") || branch.includes("@{")) throw new Error(`${field} must contain git branch names (letters, numbers, dot, underscore, slash, dash)`);
		if (seen.has(branch)) throw new Error(`${field} must not repeat a branch name`);
		seen.add(branch);
		branches.push(branch);
	}
	if (branches.length > 16) throw new Error(`${field} supports at most 16 branch names`);
	return branches;
}
/** Parse a stored branch scope. Returns undefined for absent or invalid data. */
function parseRuntimeBranches(value) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value)) return void 0;
	const branches = [];
	for (const item of value) {
		if (typeof item !== "string" || item === "" || item.length > 128 || !RUNTIME_BRANCH_NAME_RE.test(item)) return void 0;
		branches.push(item);
	}
	return branches;
}
function entryMatchesBranch(entry, branch) {
	return entry.branches === void 0 || entry.branches.length === 0 || entry.branches.includes(branch);
}
function scopeBranch(branch) {
	const value = branch?.trim();
	return value === void 0 || value === "" ? void 0 : value;
}
function normalizeContent(value, field) {
	const content = value?.trim().replace(/\s+/gu, " ") ?? "";
	if (content === "") throw new Error(`${field} is required`);
	if (content.includes("§")) throw new Error(`${field} must not contain the reserved § entry delimiter`);
	const bytes = Buffer.byteLength(content, "utf8");
	if (bytes > MAX_ENTRY_BYTES) throw new Error(`${field} is too large (${bytes} bytes; max ${MAX_ENTRY_BYTES})`);
	return content;
}
function parseEntry(value) {
	if (!isRecord(value) || typeof value.content !== "string" || !isTarget(value.target) || !isImportance(value.importance)) return void 0;
	if (typeof value.created_at !== "string" || typeof value.updated_at !== "string") return void 0;
	const content = value.content.trim().replace(/\s+/gu, " ");
	if (content === "" || content.includes("§")) return void 0;
	if (value.target === "user" && value.branches !== void 0) return void 0;
	const branches = parseRuntimeBranches(value.branches);
	return {
		content,
		created_at: value.created_at,
		updated_at: value.updated_at,
		target: value.target,
		importance: value.importance,
		...branches === void 0 ? {} : { branches }
	};
}
function byteCount(entries, target) {
	const content = entries.filter((entry) => entry.target === target).map((entry) => entry.content).join(RUNTIME_ENTRY_DELIMITER);
	return Buffer.byteLength(content, "utf8");
}
function markdown(entries, target) {
	const content = entries.filter((entry) => entry.target === target).map((entry) => entry.content).join(RUNTIME_ENTRY_DELIMITER);
	return content === "" ? "" : `${content}\n`;
}
function revision(file) {
	return createHash("sha256").update(JSON.stringify(file)).digest("hex");
}
function prepareMutation(before, request, now) {
	if (!isTarget(request.target)) throw new Error("target must be memory or user");
	if (![
		"add",
		"replace",
		"remove"
	].includes(request.action)) throw new Error("action must be add, replace, or remove");
	if (request.importance !== void 0 && !isImportance(request.importance)) throw new Error("importance must be critical, normal, or low");
	if (request.target === "user" && request.branches !== void 0) throw new Error("branches applies to target=memory only");
	const branchScope = request.branches === void 0 ? void 0 : normalizeRuntimeBranches(request.branches);
	const entries = before.map((entry) => ({ ...entry }));
	if (request.action === "add") {
		const content = normalizeContent(request.content, "content");
		const duplicate = entries.find((entry) => entry.target === request.target && entry.content === content);
		if (duplicate !== void 0) return {
			changed: false,
			projectedEntries: entries,
			compactableEntries: entries.filter((entry) => entry.target === request.target),
			fields: {
				message: "Entry already exists (no duplicate added).",
				added: duplicate.content
			}
		};
		const pendingEntry = {
			content,
			created_at: now,
			updated_at: now,
			target: request.target,
			importance: request.importance ?? "normal",
			...branchScope !== void 0 && branchScope.length > 0 ? { branches: branchScope } : {}
		};
		return {
			changed: true,
			projectedEntries: [...entries, pendingEntry],
			compactableEntries: entries.filter((entry) => entry.target === request.target),
			pendingEntry,
			fields: {
				message: "Entry added.",
				added: content
			}
		};
	}
	const oldText = normalizeContent(request.oldText, "oldText");
	const matches = entries.map((entry, index) => entry.target === request.target && entry.content.includes(oldText) ? index : -1).filter((index) => index >= 0);
	if (matches.length === 0) throw new Error(`No ${request.target} entry contains ${JSON.stringify(oldText)}.`);
	if (matches.length > 1) throw new Error(`Multiple ${request.target} entries contain ${JSON.stringify(oldText)}; use a unique substring.`);
	const index = matches[0];
	const previous = entries[index];
	const compactableEntries = entries.filter((entry, entryIndex) => entry.target === request.target && entryIndex !== index);
	if (request.action === "replace") {
		const content = normalizeContent(request.content, "content");
		const pendingEntry = {
			...previous,
			content,
			updated_at: now,
			importance: request.importance ?? previous.importance
		};
		if (branchScope !== void 0) {
			if (branchScope.length === 0) delete pendingEntry.branches;
			else pendingEntry.branches = branchScope;
		}
		entries[index] = pendingEntry;
		return {
			changed: true,
			projectedEntries: entries,
			compactableEntries,
			pendingEntry,
			excludedEntry: previous,
			fields: {
				message: "Entry replaced.",
				replaced: {
					from: previous.content,
					to: content
				}
			}
		};
	}
	return {
		changed: true,
		projectedEntries: entries.filter((_, entryIndex) => entryIndex !== index),
		compactableEntries,
		excludedEntry: previous,
		fields: {
			message: "Entry removed.",
			removed: previous.content
		}
	};
}
function compactionCandidates(compacted, existing, target, now) {
	const seen = /* @__PURE__ */ new Set();
	return compacted.map((entry) => {
		const content = normalizeContent(entry.content, "compacted content");
		if (!isImportance(entry.importance)) throw new Error("compacted importance must be critical, normal, or low");
		if (seen.has(content)) throw new Error("compacted runtime memory contains duplicate entries");
		seen.add(content);
		const unchanged = existing.find((current) => current.content === content);
		const inheritedBranches = entry.branches ?? unchanged?.branches;
		return {
			content,
			created_at: unchanged?.created_at ?? now,
			updated_at: unchanged?.updated_at ?? now,
			target,
			importance: entry.importance,
			...inheritedBranches === void 0 ? {} : { branches: inheritedBranches }
		};
	});
}
function packCompactionCandidates(replacements, target, maxBytes) {
	const priority = {
		critical: 0,
		normal: 1,
		low: 2
	};
	const ranked = replacements.map((entry, index) => ({
		entry,
		index
	})).sort((left, right) => priority[left.entry.importance] - priority[right.entry.importance] || left.index - right.index);
	const selected = /* @__PURE__ */ new Set();
	const packed = [];
	for (const candidate of ranked) {
		if (byteCount([...packed, candidate.entry], target) > maxBytes) continue;
		packed.push(candidate.entry);
		selected.add(candidate.index);
	}
	return replacements.filter((_, index) => selected.has(index));
}
function sleepSync(milliseconds) {
	const buffer = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(buffer, 0, 0, milliseconds);
}
/**
* Single authority for hot memory. JSON is the durable source of truth;
* Markdown files are deterministic projections consumed by prompt assembly.
*/
var RuntimeMemoryController = class RuntimeMemoryController {
	now;
	directory;
	sourcePath;
	userSourcePath;
	memoryPath;
	userPath;
	lockPath;
	limits;
	queue = Promise.resolve();
	localUserPath;
	userController;
	constructor(runner, now = () => /* @__PURE__ */ new Date(), limits = RUNTIME_MEMORY_LIMITS, userRunner) {
		this.now = now;
		for (const [target, limit] of Object.entries(limits)) if (!Number.isInteger(limit) || limit < 1 || limit > 1048576) throw new Error(`runtime ${target} memory limit must be an integer within 1..${MAX_RUNTIME_MEMORY_LIMIT_BYTES} bytes`);
		this.limits = {
			memory: limits.memory,
			user: limits.user
		};
		this.directory = join(runner.effectiveDataDir(), "runtime");
		this.sourcePath = join(this.directory, "memories.json");
		this.memoryPath = join(this.directory, "MEMORY.md");
		this.localUserPath = join(this.directory, "USER.md");
		this.lockPath = join(this.directory, ".memories.lock");
		const userDirectory = userRunner === void 0 ? this.directory : join(userRunner.effectiveDataDir(), "runtime");
		this.userController = userDirectory === this.directory || userRunner === void 0 ? void 0 : new RuntimeMemoryController(userRunner, now, this.limits);
		this.userPath = this.userController?.userPath ?? this.localUserPath;
		this.userSourcePath = this.userController?.sourcePath ?? this.sourcePath;
		this.initialize();
	}
	snapshot() {
		const local = this.readSource();
		if (this.userController === void 0) return this.snapshotUnlocked(local);
		const global = this.userController.readSource();
		return this.snapshotUnlocked({
			version: 1,
			entries: [...global.entries.filter((entry) => entry.target === "user"), ...local.entries.filter((entry) => entry.target === "memory")]
		});
	}
	contextText(branch) {
		return this.contextProjection(branch).text;
	}
	/**
	* Read the exact Runtime revision and its prompt projection from each
	* configured authority root.
	* When a git branch is supplied, target=memory entries scoped to other
	* branches are hidden from the projection; the on-disk Markdown files and
	* the source JSON always remain complete.
	*/
	contextProjection(branch) {
		const branchScope = scopeBranch(branch);
		const local = this.localContextProjection(branchScope);
		const global = this.userController?.localContextProjection();
		const user = global?.user ?? local.user;
		const memory = local.memory;
		const entries = global === void 0 ? local.snapshot.entries : [...global.snapshot.entries.filter((entry) => entry.target === "user"), ...local.snapshot.entries.filter((entry) => entry.target === "memory")];
		const visibleMemory = local.snapshot.targets.memory;
		const visibleUser = global?.snapshot.targets.user ?? local.snapshot.targets.user;
		const snapshot = global === void 0 ? local.snapshot : {
			directory: this.directory,
			sourcePath: this.sourcePath,
			revision: revision({
				version: 1,
				entries
			}),
			generatedAt: this.now().toISOString(),
			entries,
			targets: {
				memory: {
					...visibleMemory,
					markdownPath: this.memoryPath
				},
				user: {
					...visibleUser,
					markdownPath: this.userPath
				}
			}
		};
		const storeMemory = this.targetView(entries, "memory");
		const storeUser = this.targetView(entries, "user");
		const visibleEntries = branchScope === void 0 ? entries : entries.filter((entry) => entry.target === "user" || entryMatchesBranch(entry, branchScope));
		const branchLine = branchScope === void 0 ? "" : `\nGit branch: ${branchScope}${local.hidden > 0 ? ` (${local.hidden} branch-scoped entr${local.hidden === 1 ? "y" : "ies"} hidden)` : ""}`;
		return {
			revision: snapshot.revision,
			entries: visibleEntries.map((entry) => ({
				...entry,
				...entry.branches === void 0 ? {} : { branches: [...entry.branches] }
			})),
			totalEntries: entries.length,
			text: `MNEMON RUNTIME MEMORY SNAPSHOT
Revision: ${snapshot.revision}${branchLine}

Contents of USER.md (user profile; entries: ${visibleUser.entryCount}; UTF-8 bytes: ${storeUser.used}/${storeUser.limit})
<runtime-memory-file name="USER.md">
${user || "(empty)"}
</runtime-memory-file>

Contents of MEMORY.md (working reference; entries: ${visibleMemory.entryCount}; UTF-8 bytes: ${storeMemory.used}/${storeMemory.limit})
<runtime-memory-file name="MEMORY.md">
${memory || "(empty)"}
</runtime-memory-file>`
		};
	}
	localContextProjection(branch) {
		const branchScope = scopeBranch(branch);
		return this.withLock(() => {
			const file = this.readSource();
			this.repairProjections(file);
			const entries = file.entries.map((entry) => ({ ...entry }));
			const visible = branchScope === void 0 ? entries : entries.filter((entry) => entry.target === "user" || entryMatchesBranch(entry, branchScope));
			return {
				snapshot: {
					directory: this.directory,
					sourcePath: this.sourcePath,
					revision: revision(file),
					generatedAt: this.now().toISOString(),
					entries,
					targets: {
						memory: this.targetView(visible, "memory"),
						user: this.targetView(visible, "user")
					}
				},
				user: readFileSync(this.localUserPath, "utf8").trimEnd(),
				memory: branchScope === void 0 ? readFileSync(this.memoryPath, "utf8").trimEnd() : markdown(visible, "memory").trimEnd(),
				hidden: branchScope === void 0 ? 0 : entries.length - visible.length
			};
		});
	}
	mutate(request) {
		if (request.target === "user" && this.userController !== void 0) return this.userController.mutate(request);
		const operation = this.queue.then(() => this.withLock(() => this.mutateLocked(request)));
		this.queue = operation.catch(() => void 0);
		return operation;
	}
	/** Resolve exactly which committed entries survive a blocked mutation and are safe to compact. */
	planMaintenance(request) {
		if (request.target === "user" && this.userController !== void 0) return this.userController.planMaintenance(request);
		const operation = this.queue.then(() => this.withLock(() => {
			const file = this.readSource();
			const prepared = prepareMutation(file.entries, request, this.now().toISOString());
			const used = byteCount(file.entries, request.target);
			const projected = byteCount(prepared.projectedEntries, request.target);
			const limit = this.limits[request.target];
			return {
				revision: revision(file),
				action: request.action,
				target: request.target,
				entries: prepared.compactableEntries.map((entry) => ({ ...entry })),
				...prepared.pendingEntry === void 0 ? {} : { pending: {
					content: prepared.pendingEntry.content,
					importance: prepared.pendingEntry.importance
				} },
				...prepared.excludedEntry === void 0 ? {} : { excluded: { ...prepared.excludedEntry } },
				used,
				projected,
				limit,
				requiresMaintenance: prepared.changed && projected > limit
			};
		}));
		this.queue = operation.catch(() => void 0);
		return operation;
	}
	/** Commit semantic compaction and the original mutation together, or leave every local file unchanged. */
	compactAndMutate(expectedRevision, request, compacted, maxCompactedBytes) {
		if (request.target === "user" && this.userController !== void 0) return this.userController.compactAndMutate(expectedRevision, request, compacted, maxCompactedBytes);
		const operation = this.queue.then(() => this.withLock(() => {
			const file = this.readSource();
			if (revision(file) !== expectedRevision) throw new RuntimeMemoryConflictError();
			const now = this.now().toISOString();
			const prepared = prepareMutation(file.entries, request, now);
			const compactedByteBudget = maxCompactedBytes ?? this.limits[request.target];
			if (!Number.isInteger(compactedByteBudget) || compactedByteBudget < 0 || compactedByteBudget > this.limits[request.target]) throw new Error("compaction byte budget is invalid");
			if (!prepared.changed) return this.result(request.target, prepared.projectedEntries, prepared.fields);
			const replacements = compactionCandidates(compacted, prepared.compactableEntries, request.target, now);
			if (prepared.pendingEntry !== void 0 && replacements.some((entry) => entry.content === prepared.pendingEntry.content)) throw new Error("compacted runtime memory duplicates the pending mutation");
			if (prepared.excludedEntry !== void 0 && replacements.some((entry) => entry.content === prepared.excludedEntry.content)) throw new Error("compacted runtime memory reintroduces the replaced or removed entry");
			const targetEntries = [...packCompactionCandidates(replacements, request.target, compactedByteBudget), ...prepared.pendingEntry === void 0 ? [] : [prepared.pendingEntry]];
			const entries = [...file.entries.filter((entry) => entry.target !== request.target), ...targetEntries];
			const used = byteCount(entries, request.target);
			const limit = this.limits[request.target];
			if (used > limit) throw new RuntimeMemoryCapacityError(request.target, byteCount(file.entries, request.target), used, limit);
			const next = {
				version: 1,
				entries
			};
			this.persist(next);
			return this.result(request.target, entries, prepared.fields);
		}));
		this.queue = operation.catch(() => void 0);
		return operation;
	}
	/** Apply an LLM-produced compaction only to the exact snapshot it reviewed. */
	compactTarget(expectedRevision, target, compacted, maxBytes) {
		if (target === "user" && this.userController !== void 0) return this.userController.compactTarget(expectedRevision, target, compacted, maxBytes).then(() => this.snapshot());
		const operation = this.queue.then(() => this.withLock(() => {
			const file = this.readSource();
			if (revision(file) !== expectedRevision) throw new RuntimeMemoryConflictError();
			const byteBudget = maxBytes ?? this.limits[target];
			if (!Number.isInteger(byteBudget) || byteBudget < 0 || byteBudget > this.limits[target]) throw new Error("compaction byte budget is invalid");
			const now = this.now().toISOString();
			const fitted = packCompactionCandidates(compactionCandidates(compacted, file.entries.filter((entry) => entry.target === target), target, now), target, byteBudget);
			const entries = [...file.entries.filter((entry) => entry.target !== target), ...fitted];
			const used = byteCount(entries, target);
			const limit = this.limits[target];
			if (used > limit) throw new RuntimeMemoryCapacityError(target, byteCount(file.entries, target), used, limit);
			this.persist({
				version: 1,
				entries
			});
			return this.snapshotUnlocked({
				version: 1,
				entries
			});
		}));
		this.queue = operation.catch(() => void 0);
		return this.userController === void 0 ? operation : operation.then(() => this.snapshot());
	}
	initialize() {
		mkdirSync(this.directory, {
			recursive: true,
			mode: 448
		});
		this.withLock(() => {
			const file = this.readSource();
			this.persist(file);
		});
	}
	mutateLocked(request) {
		const file = this.readSource();
		const prepared = prepareMutation(file.entries, request, this.now().toISOString());
		if (!prepared.changed) return this.result(request.target, prepared.projectedEntries, prepared.fields);
		const used = byteCount(prepared.projectedEntries, request.target);
		const limit = this.limits[request.target];
		if (used > limit) throw new RuntimeMemoryCapacityError(request.target, byteCount(file.entries, request.target), used, limit);
		this.persist({
			version: 1,
			entries: prepared.projectedEntries
		});
		return this.result(request.target, prepared.projectedEntries, prepared.fields);
	}
	result(target, entries, fields) {
		return {
			success: true,
			message: fields.message,
			target,
			entryCount: entries.filter((entry) => entry.target === target).length,
			usage: {
				used: byteCount(entries, target),
				limit: this.limits[target]
			},
			...fields.added === void 0 ? {} : { added: fields.added },
			...fields.replaced === void 0 ? {} : { replaced: fields.replaced },
			...fields.removed === void 0 ? {} : { removed: fields.removed }
		};
	}
	targetView(entries, target) {
		return {
			target,
			entryCount: entries.filter((entry) => entry.target === target).length,
			used: byteCount(entries, target),
			limit: this.limits[target],
			markdownPath: target === "memory" ? this.memoryPath : this.userPath
		};
	}
	snapshotUnlocked(file) {
		const entries = file.entries.map((entry) => ({ ...entry }));
		return {
			directory: this.directory,
			sourcePath: this.sourcePath,
			revision: revision(file),
			generatedAt: this.now().toISOString(),
			entries,
			targets: {
				memory: this.targetView(entries, "memory"),
				user: this.targetView(entries, "user")
			}
		};
	}
	readSource() {
		if (!existsSync(this.sourcePath)) return {
			version: 1,
			entries: []
		};
		let parsed;
		try {
			parsed = JSON.parse(readFileSync(this.sourcePath, "utf8"));
		} catch (error) {
			throw new Error(`runtime memories.json is unreadable: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error(`runtime memories.json must use version 1`);
		const entries = parsed.entries.map(parseEntry);
		if (entries.some((entry) => entry === void 0)) throw new Error("runtime memories.json contains an invalid entry");
		return {
			version: 1,
			entries
		};
	}
	persist(file) {
		mkdirSync(this.directory, {
			recursive: true,
			mode: 448
		});
		const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
		const writes = [
			[this.localUserPath, markdown(file.entries, "user")],
			[this.memoryPath, markdown(file.entries, "memory")],
			[this.sourcePath, `${JSON.stringify(file, null, 2)}\n`]
		];
		const temporaries = writes.map(([path]) => join(this.directory, `.${basename(path)}.${nonce}.tmp`));
		try {
			writes.forEach(([, content], index) => writeFileSync(temporaries[index], content, {
				encoding: "utf8",
				mode: 384
			}));
			writes.forEach(([path], index) => renameSync(temporaries[index], path));
		} finally {
			for (const temporary of temporaries) rmSync(temporary, { force: true });
		}
	}
	repairProjections(file) {
		for (const [path, target] of [[this.localUserPath, "user"], [this.memoryPath, "memory"]]) {
			const expected = markdown(file.entries, target);
			let current;
			try {
				current = readFileSync(path, "utf8");
			} catch {
				current = void 0;
			}
			if (current === expected) continue;
			const temporary = join(this.directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
			try {
				writeFileSync(temporary, expected, {
					encoding: "utf8",
					mode: 384
				});
				renameSync(temporary, path);
			} finally {
				rmSync(temporary, { force: true });
			}
		}
	}
	withLock(callback) {
		const started = Date.now();
		let descriptor;
		while (descriptor === void 0) try {
			descriptor = openSync(this.lockPath, "wx", 384);
		} catch (error) {
			if ((isRecord(error) && typeof error.code === "string" ? error.code : void 0) !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS) {
					rmSync(this.lockPath, { force: true });
					continue;
				}
			} catch {
				continue;
			}
			if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error("timed out waiting for the runtime memory controller lock");
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
//#endregion
//#region src/source.ts
const ACTIONS = /* @__PURE__ */ new Set([
	"add",
	"replace",
	"remove"
]);
const TARGETS = /* @__PURE__ */ new Set(["memory", "user"]);
const IMPORTANCE = /* @__PURE__ */ new Set([
	"critical",
	"normal",
	"low"
]);
function runtimeMutation(value) {
	const input = memoryInputRecord(value, "Runtime Memory mutation");
	const action = memoryInputText(input.action, "action", 20);
	const target = memoryInputText(input.target, "target", 20);
	if (!ACTIONS.has(action)) throw new Error(`unsupported Runtime Memory action: ${action}`);
	if (!TARGETS.has(target)) throw new Error(`unsupported Runtime Memory target: ${target}`);
	const importance = memoryInputText(input.importance, "importance", 20, false);
	if (importance !== void 0 && !IMPORTANCE.has(importance)) throw new Error(`unsupported Runtime Memory importance: ${importance}`);
	return {
		action,
		target,
		...memoryInputText(input.content, "content", 1e5, false) === void 0 ? {} : { content: memoryInputText(input.content, "content", 1e5, false) },
		...memoryInputText(input.oldText ?? input.old_text, "oldText", 1e5, false) === void 0 ? {} : { oldText: memoryInputText(input.oldText ?? input.old_text, "oldText", 1e5, false) },
		...importance === void 0 ? {} : { importance },
		...input.branches === void 0 ? {} : { branches: memoryInputStringArray(input.branches, "branches", 100) ?? [] }
	};
}
function createRuntimeMemorySource(config = {}) {
	const configured = Object.freeze({ ...config });
	return defineMemorySource({
		manifest: {
			apiVersion: COMPOSABLE_MEMORY_API_VERSION,
			kind: "source",
			typeId: "runtime",
			packageName: "dsh-mnemon-source-runtime",
			role: "working-context",
			capabilities: [
				"status",
				"project",
				"write"
			],
			consistency: "exact-snapshot",
			actions: [{
				id: "mutate",
				description: "Add, replace, or remove an entry in Runtime Memory.",
				capability: "write",
				inputSchema: {
					type: "object",
					required: ["action", "target"],
					additionalProperties: false,
					properties: {
						action: {
							type: "string",
							enum: [
								"add",
								"replace",
								"remove"
							]
						},
						target: {
							type: "string",
							enum: ["memory", "user"]
						},
						content: { type: "string" },
						oldText: { type: "string" },
						importance: {
							type: "string",
							enum: [
								"critical",
								"normal",
								"low"
							]
						},
						branches: { type: "array" }
					}
				}
			}],
			management: {
				label: "Runtime Memory",
				description: "Exact, bounded working context and user profile projection."
			}
		},
		create(context) {
			const effective = runtimeSourceConfig({
				...context.configuration,
				...configured
			}, context.sourceInstanceKey);
			const controller = new RuntimeMemoryController({ effectiveDataDir: () => effective.dataDir }, void 0, {
				memory: effective.memoryLimitBytes,
				user: effective.userLimitBytes
			}, { effectiveDataDir: () => effective.userDataDir });
			const projection = (workspaceId) => controller.contextProjection(resolveGitBranch(workspaceId));
			const prepared = /* @__PURE__ */ new WeakMap();
			return {
				facts(request) {
					if (request.scenario.startsWith("management.")) return {
						sourceInstanceKey: context.sourceInstanceKey,
						sourceTypeId: "runtime",
						role: "working-context",
						availability: "ready",
						revision: controller.snapshot().revision,
						capabilities: [
							"status",
							"project",
							"write"
						],
						routeIds: [],
						actionIds: ["mutate"]
					};
					const current = projection(request.scope.workspaceId);
					prepared.set(request.scope, current);
					return {
						sourceInstanceKey: context.sourceInstanceKey,
						sourceTypeId: "runtime",
						role: "working-context",
						availability: "ready",
						revision: current.revision,
						capabilities: [
							"status",
							"project",
							"write"
						],
						routeIds: [],
						actionIds: ["mutate"]
					};
				},
				project(request) {
					if (!request.includeProjection) return { fragments: [] };
					const current = prepared.get(request.scope) ?? projection(request.scope.workspaceId);
					prepared.delete(request.scope);
					if (current.revision !== request.expectedRevision) throw new Error("Runtime projection revision changed during composition");
					return {
						fragments: [{
							id: `${context.sourceInstanceKey}/projection`,
							sourceInstanceKey: context.sourceInstanceKey,
							mode: request.mode,
							text: truncateMemoryText(current.text, request.maxCharacters),
							revision: current.revision,
							provenance: { sourceTypeId: "runtime" }
						}],
						presentation: {
							visibleItems: current.entries.length,
							totalItems: current.totalEntries,
							items: current.entries.slice(0, 24).map((entry, index) => ({
								id: `${entry.target}:${entry.created_at}:${index}`,
								title: truncateMemoryText(entry.content, 160)
							}))
						}
					};
				},
				async manage(request) {
					const input = request.input === null ? {} : memoryInputRecord(request.input, "Runtime Memory management");
					if (request.mode === "read") {
						let value;
						if (request.operation === "snapshot") value = controller.snapshot();
						else if (request.operation === "maintenance-plan") value = await controller.planMaintenance(runtimeMutation(request.input));
						else throw new Error("unsupported Runtime management read operation: " + request.operation);
						return {
							revision: controller.snapshot().revision,
							value
						};
					}
					if (!request.confirmed) throw new Error("Runtime management mutation requires explicit confirmation");
					let result;
					if (request.operation === "mutate") result = await controller.mutate(runtimeMutation(request.input));
					else if (request.operation === "compact-and-mutate") {
						if (!Array.isArray(input.compacted)) throw new Error("compacted must be an array");
						const compacted = input.compacted.map((value) => {
							const entry = memoryInputRecord(value, "compacted entry");
							const importance = memoryInputText(entry.importance, "importance", 20);
							if (!IMPORTANCE.has(importance)) throw new Error("invalid compacted importance");
							return {
								content: memoryInputText(entry.content, "content", 1e5),
								importance,
								...entry.branches === void 0 ? {} : { branches: memoryInputStringArray(entry.branches, "branches", 100) ?? [] }
							};
						});
						result = await controller.compactAndMutate(memoryInputText(input.revision, "revision", 300), runtimeMutation(input.mutation), compacted, typeof input.maxBytes === "number" ? input.maxBytes : void 0);
					} else throw new Error("unsupported Runtime management mutation operation: " + request.operation);
					return {
						revision: controller.snapshot().revision,
						value: result
					};
				},
				async mutate(request) {
					const result = await controller.mutate(runtimeMutation(request.input));
					const revision = controller.snapshot().revision;
					return createMemoryMutationReceipt(request.view.id, request.offer.id, context.sourceInstanceKey, revision, result, "committed");
				}
			};
		}
	});
}
const RUNTIME_MEMORY_SOURCE = createRuntimeMemorySource();
//#endregion
//#region src/index.ts
const name = "dsh-mnemon-source-runtime";
const inject = ["mnemonMemory"];
const memoryPlugin = defineMemoryPlugin({
	packageName: name,
	label: {
		en: "Runtime memory",
		"zh-CN": "运行时记忆"
	},
	description: {
		en: "Working context for the current runtime and task.",
		"zh-CN": "当前运行环境与任务使用的工作上下文。"
	},
	roles: ["source"],
	provides: [{ id: "source" }, { id: "source.working-context" }]
});
function apply(ctx, config = {}) {
	installMemory(ctx, {
		plugin: memoryPlugin,
		sources: [createRuntimeMemorySource(config)]
	}, { effectiveDigest: memoryConfigurationDigest(config) });
}
//#endregion
export { Config, RUNTIME_MEMORY_SOURCE, apply, createRuntimeMemorySource, inject, memoryPlugin, name };
