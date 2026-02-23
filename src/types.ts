/**
 * Function that converts text strings into embedding vectors.
 * Users provide their own implementation or use a built-in adapter (e.g. Ollama).
 */
export type EmbedFunction = (texts: string[]) => Promise<number[][]>;

// ---------------------------------------------------------------------------
// Phases & Status
// ---------------------------------------------------------------------------

export type RagPhase = "idle" | "scanning" | "embedding" | "ready" | "error";

export interface RagStatus {
    folderPath: string;
    enabled: boolean;
    phase: RagPhase;
    totalFiles: number;
    filesToEmbed: number;
    embeddedFiles: number;
    skippedUnchanged: number;
    totalChunks: number;
    dbSizeBytes: number;
    lastIndexedAt?: number;
    staleWarning: boolean;
    staleAgeMs: number;
    staleThresholdMs: number;
    fileChangeDrift: number;
    driftAddedFiles: number;
    driftModifiedFiles: number;
    driftDeletedFiles: number;
    driftCheckedAt?: number;
    message?: string;
    includeExtensions: string[];
    excludeFolders: string[];
    cachedFolders: string[];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface RagSearchMatch {
    filePath: string;
    score: number;
    content: string;
}

export interface RagSearchResult {
    folderPath: string;
    query: string;
    durationMs: number;
    totalChunks: number;
    matches: RagSearchMatch[];
}

// ---------------------------------------------------------------------------
// Chunks & Files
// ---------------------------------------------------------------------------

export interface CodeSymbol {
    name: string;
    kind: "function" | "class" | "method" | "interface" | "type" | "enum" | "module" | "variable" | "import" | "export" | "other";
    nameRange: {
        start: { line: number; column: number; offset: number };
        end: { line: number; column: number; offset: number };
    };
    contentRange: {
        start: { line: number; column: number; offset: number };
        end: { line: number; column: number; offset: number };
    };
}

export interface RagChunk {
    id: string;
    filePath: string;
    modifiedAt: number;
    content: string;
    embedding: number[];
    symbols?: CodeSymbol[];
}

export interface RagFileState {
    modifiedAt: number;
    size: number;
    contentHash: string;
    chunkIds: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RagFolderConfig {
    enabled: boolean;
    includeExtensions: string[];
    excludeFolders: string[];
}

// ---------------------------------------------------------------------------
// Candidate Files (scanner output)
// ---------------------------------------------------------------------------

export interface CandidateFile {
    relativePath: string;
    fullPath: string;
    modifiedAt: number;
    size: number;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

export interface ChunkResult {
    content: string;
    symbols?: CodeSymbol[];
}

export interface ChunkingOptions {
    /** Maximum characters per chunk. Default: 1200 */
    chunkSize?: number;
    /** Overlap in characters between consecutive chunks. Default: 200 */
    chunkOverlap?: number;
    /** File extension (e.g. ".ts") used to select the right parser. */
    fileExtension?: string;
    /** File path for context in chunk IDs. */
    filePath?: string;
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

export interface IndexOptions {
    includeExtensions?: string[];
    excludeFolders?: string[];
    /** Maximum file size in bytes. Default: 1MB */
    maxFileSize?: number;
    /** Number of files to embed in parallel. Default: 2 */
    concurrency?: number;
    /** Batch size for embedding calls. Default: 16 */
    embedBatchSize?: number;
    /** Progress callback fired during indexing. */
    onProgress?: (status: RagStatus) => void;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchOptions {
    /** Number of top results to return. Default: 6 */
    topK?: number;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface PersistedRagDb {
    version: number;
    chunks: RagChunk[];
}

export interface PersistedRagIndex {
    version: number;
    files: Record<string, RagFileState>;
    updatedAt?: number;
}

// ---------------------------------------------------------------------------
// ANN Index
// ---------------------------------------------------------------------------

export interface LshAnnIndex {
    dimensions: number;
    projection: number[][];
    buckets: Map<string, string[]>;
}

// ---------------------------------------------------------------------------
// Cache entries
// ---------------------------------------------------------------------------

export interface CachedQueryEmbedding {
    embedding: number[];
    createdAt: number;
}

export interface CachedQueryResult {
    chunkIds: string[];
    scores: number[];
    createdAt: number;
    revision: number;
}

// ---------------------------------------------------------------------------
// Folder cache (internal state per indexed folder)
// ---------------------------------------------------------------------------

export interface FolderCache {
    folderPath: string;
    config: RagFolderConfig;
    status: RagStatus;
    chunks: Map<string, RagChunk>;
    fileStates: Map<string, RagFileState>;
    persistedLoaded: boolean;
    runningIndex?: Promise<RagStatus>;
    runningHealthRefresh?: Promise<void>;
    queryEmbeddingCache: Map<string, CachedQueryEmbedding>;
    queryResultCache: Map<string, CachedQueryResult>;
    indexRevision: number;
    annIndex?: LshAnnIndex;
}
