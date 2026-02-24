// Main classes
export { CodebaseIndexer } from "./indexer/index.js";
export type { CodebaseIndexerOptions } from "./indexer/index.js";
export { CodebaseSearcher } from "./search/index.js";

// Embedding adapters
export { createOllamaEmbed, createOpenAICompatibleEmbed } from "./embedding/index.js";
export type { OllamaEmbedOptions, OpenAICompatibleEmbedOptions } from "./embedding/index.js";

// Chunking strategies
export { TextChunker } from "./chunking/index.js";
export { CodeChunker } from "./chunking/index.js";
export { getGrammarForExtension, getSymbolNodeTypes, nodeTypeToSymbolKind } from "./chunking/index.js";
export { EXTENSION_TO_GRAMMAR, SYMBOL_NODE_TYPES } from "./chunking/index.js";
export type { LanguageProfile, CodeSymbol as TreeSitterCodeSymbol, SymbolKind } from "tree-sitter-ts";

// Vector search
export { cosineSimilarity } from "./vector/index.js";
export { LshIndex } from "./vector/index.js";
export type { LshOptions } from "./vector/index.js";

// Scanner
export { scanDirectory } from "./scanner/index.js";
export type { ScanOptions } from "./scanner/index.js";

// Storage
export { loadFromDisk, saveToDisk, getDbSizeBytes, clearStorage } from "./storage/index.js";
export type { LoadResult } from "./storage/index.js";

// Cache
export { LruCache } from "./cache/index.js";

// Types
export type {
    EmbedOptions,
    EmbedFunction,
    RagPhase,
    RagStatus,
    RagSearchMatch,
    RagSearchResult,
    RagChunk,
    RagFileState,
    RagFolderConfig,
    CandidateFile,
    CodeSymbol,
    ChunkResult,
    ChunkingOptions,
    IndexOptions,
    SearchOptions,
    PersistedRagDb,
    PersistedRagIndex,
    LshAnnIndex,
    FolderCache,
} from "./types.js";

// Defaults & constants
export {
    CHUNK_SIZE,
    CHUNK_OVERLAP,
    EMBED_BATCH_SIZE,
    EMBEDDING_PRECISION,
    FILE_EMBED_CONCURRENCY,
    TOP_K,
    QUERY_CACHE_TTL_MS,
    QUERY_EMBED_CACHE_MAX,
    QUERY_RESULT_CACHE_MAX,
    QUERY_RESULT_CACHE_TOP_K,
    ANN_PROJECTION_DIM,
    ANN_MAX_HAMMING_DISTANCE,
    ANN_FALLBACK_MIN_CANDIDATES,
    ANN_MAX_RERANK_CANDIDATES,
    HEALTH_REFRESH_INTERVAL_MS,
    STALE_INDEX_THRESHOLD_MS,
    RAG_STORAGE_DIR,
    RAG_DB_FILE,
    RAG_INDEX_FILE,
    RAG_DB_VERSION,
    RAG_INDEX_VERSION,
    MAX_FILE_BYTES,
    DEFAULT_SKIP_FOLDERS,
    DEFAULT_SKIP_FILES,
    DEFAULT_SKIP_EXTENSIONS,
    DEFAULT_INCLUDE_EXTENSIONS_BY_LANGUAGE,
    DEFAULT_INCLUDE_EXTENSIONS,
} from "./defaults.js";
