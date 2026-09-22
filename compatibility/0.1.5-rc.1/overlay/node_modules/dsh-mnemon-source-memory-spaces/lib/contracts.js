//#region src/contracts.ts
const CATEGORIES = [
	"preference",
	"decision",
	"fact",
	"insight",
	"context",
	"general"
];
const SOURCES = [
	"user",
	"agent",
	"external"
];
const EDGE_TYPES = [
	"temporal",
	"semantic",
	"causal",
	"entity"
];
const INTENTS = [
	"WHY",
	"WHEN",
	"ENTITY",
	"GENERAL"
];
const DEFAULT_EMBEDDING_ENDPOINT = "http://localhost:11434";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
const EMBEDDING_PROTOCOL_AUTO = "auto";
const EMBEDDING_PROTOCOL_OLLAMA = "ollama";
const EMBEDDING_PROTOCOL_OPENAI = "openai";
/** Default protocol defers to Mnemon's /v1 auto-detection. */
const DEFAULT_EMBEDDING_PROTOCOL = EMBEDDING_PROTOCOL_AUTO;
/** Wire protocols accepted by the embedding protocol override; single source for schema, resolver, and UI validation. */
const MNEMON_EMBEDDING_PROTOCOLS = [
	EMBEDDING_PROTOCOL_AUTO,
	EMBEDDING_PROTOCOL_OLLAMA,
	EMBEDDING_PROTOCOL_OPENAI
];
//#endregion
export { CATEGORIES, DEFAULT_EMBEDDING_ENDPOINT, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_PROTOCOL, EDGE_TYPES, EMBEDDING_PROTOCOL_AUTO, EMBEDDING_PROTOCOL_OLLAMA, EMBEDDING_PROTOCOL_OPENAI, INTENTS, MNEMON_EMBEDDING_PROTOCOLS, SOURCES };
