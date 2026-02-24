// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 200;
export const MIN_CHUNK_SIZE = 200;

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

export const EMBED_BATCH_SIZE = 16;
export const FILE_EMBED_CONCURRENCY = 2;
export const EMBEDDING_PRECISION = 1e6; // 6 decimal places for persisted embeddings

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const TOP_K = 6;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export const QUERY_CACHE_TTL_MS = 10 * 60 * 1000;
export const QUERY_EMBED_CACHE_MAX = 128;
export const QUERY_RESULT_CACHE_MAX = 64;
export const QUERY_RESULT_CACHE_TOP_K = 24;

// ---------------------------------------------------------------------------
// ANN / LSH
// ---------------------------------------------------------------------------

export const ANN_PROJECTION_DIM = 16;
export const ANN_MAX_HAMMING_DISTANCE = 3;
export const ANN_FALLBACK_MIN_CANDIDATES = 32;
export const ANN_MAX_RERANK_CANDIDATES = 1200;

// ---------------------------------------------------------------------------
// Health & Staleness
// ---------------------------------------------------------------------------

export const HEALTH_REFRESH_INTERVAL_MS = 15 * 1000;
export const STALE_INDEX_THRESHOLD_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const RAG_STORAGE_DIR = ".rag-ts";
export const RAG_DB_FILE = ".rag-db";
export const RAG_INDEX_FILE = ".rag-index";
export const RAG_DB_VERSION = 1;
export const RAG_INDEX_VERSION = 1;

// ---------------------------------------------------------------------------
// File Scanning
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 1_048_576; // 1 MB

export const DEFAULT_SKIP_FOLDERS = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "__pycache__",
    ".venv",
    ".rag-ts",
];

export const DEFAULT_SKIP_FILES = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    ".DS_Store",
    "Thumbs.db",
];

export const DEFAULT_SKIP_EXTENSIONS = [".lock", ".log", ".map"];

/**
 * File extensions grouped by language for RAG indexing.
 */
export const DEFAULT_INCLUDE_EXTENSIONS_BY_LANGUAGE: Record<string, string[]> = {
    json: [".json"],
    css: [".css"],
    scss: [".scss"],
    python: [".py", ".pyi", ".pyw"],
    go: [".go"],
    javascript: [".js", ".mjs", ".cjs", ".jsx"],
    typescript: [".ts", ".mts", ".cts", ".tsx"],
    cpp: [".cpp", ".hpp", ".cc", ".hh", ".cxx", ".hxx", ".h"],
    html: [".html", ".htm"],
    markdown: [".md", ".markdown", ".mdx"],
    yaml: [".yaml", ".yml"],
    xml: [".xml", ".xsd", ".xsl", ".xslt", ".svg"],
    java: [".java"],
    csharp: [".cs", ".csx"],
    rust: [".rs"],
    ruby: [".rb", ".rake", ".gemspec"],
    php: [".php", ".phtml", ".php8"],
    kotlin: [".kt", ".kts"],
    swift: [".swift"],
    shell: [".sh", ".bash", ".zsh", ".ksh"],
    sql: [".sql"],
    toml: [".toml"],
};

/**
 * Default include extensions — all languages combined.
 */
export const DEFAULT_INCLUDE_EXTENSIONS: string[] = Object.values(
    DEFAULT_INCLUDE_EXTENSIONS_BY_LANGUAGE,
).flat();
