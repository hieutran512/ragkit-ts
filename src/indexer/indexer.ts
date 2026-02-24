import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { extname } from "path";
import {
    EMBED_BATCH_SIZE,
    FILE_EMBED_CONCURRENCY,
    STALE_INDEX_THRESHOLD_MS,
    HEALTH_REFRESH_INTERVAL_MS,
    DEFAULT_INCLUDE_EXTENSIONS,
    DEFAULT_SKIP_FOLDERS,
} from "../defaults.js";
import type {
    CandidateFile,
    EmbedFunction,
    FolderCache,
    IndexOptions,
    RagFolderConfig,
    RagStatus,
} from "../types.js";
import { CodeChunker } from "../chunking/code-chunker.js";
import { scanDirectory } from "../scanner/file-scanner.js";
import { loadFromDisk, saveToDisk, getDbSizeBytes } from "../storage/disk-storage.js";
import { clearStorage } from "../storage/disk-storage.js";
import { LshIndex } from "../vector/lsh.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeFolderPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizeExtensions(values: string[] | undefined): string[] {
    if (!values || values.length === 0) return [...DEFAULT_INCLUDE_EXTENSIONS];
    const normalized = values
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
        .map((v) => (v.startsWith(".") ? v : `.${v}`));
    return Array.from(new Set(normalized));
}

function normalizeFolders(values: string[] | undefined): string[] {
    if (!values || values.length === 0) return [...DEFAULT_SKIP_FOLDERS];
    return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function computeContentHash(content: string): string {
    return createHash("sha1").update(content).digest("hex");
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>,
    signal?: AbortSignal,
): Promise<void> {
    if (items.length === 0) return;
    const limit = Math.max(1, concurrency);
    let nextIndex = 0;

    const runWorker = async (): Promise<void> => {
        while (true) {
            if (signal?.aborted) {
                throw signal.reason ?? new DOMException("Aborted", "AbortError");
            }
            const current = nextIndex;
            nextIndex += 1;
            if (current >= items.length) return;
            await worker(items[current], current);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
}

// ---------------------------------------------------------------------------
// CodebaseIndexer
// ---------------------------------------------------------------------------

export interface CodebaseIndexerOptions {
    /** The embedding function to use. */
    embed: EmbedFunction;
    /** Use AST-aware code chunking. Default: true. */
    codeAwareChunking?: boolean;
}

/**
 * Indexes a codebase folder for RAG search.
 *
 * Orchestrates: file scanning → chunking → embedding → persistence.
 * Supports incremental re-indexing — only changed files are re-embedded.
 *
 * @example
 * ```ts
 * const indexer = new CodebaseIndexer({ embed: createOllamaEmbed() });
 * const status = await indexer.index("/path/to/project", {
 *   includeExtensions: [".ts", ".js"],
 *   onProgress: (s) => console.log(s.message),
 * });
 * ```
 */
export class CodebaseIndexer {
    private embed: EmbedFunction;
    private caches = new Map<string, FolderCache>();
    private codeChunker: CodeChunker;
    private lsh = new LshIndex();

    constructor(options: CodebaseIndexerOptions) {
        this.embed = options.embed;
        const useCode = options.codeAwareChunking !== false;
        this.codeChunker = useCode ? new CodeChunker() : new CodeChunker();
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Index a folder. Scans for files, chunks content, embeds, and persists.
     * Skips unchanged files for incremental re-indexing.
     */
    async index(folderPath: string, options?: IndexOptions): Promise<RagStatus> {
        const cache = this.ensureCache(folderPath);
        const config = cache.config;

        // Apply options to config
        config.enabled = true;
        cache.status.enabled = true;
        if (options?.includeExtensions) {
            config.includeExtensions = normalizeExtensions(options.includeExtensions);
        }
        if (options?.excludeFolders) {
            config.excludeFolders = normalizeFolders(options.excludeFolders);
        }
        if (options?.outputFolder) {
            cache.storagePath = normalizeFolderPath(options.outputFolder);
        }

        if (cache.runningIndex) {
            return cache.runningIndex;
        }

        const onProgress = options?.onProgress;
        const concurrency = options?.concurrency ?? FILE_EMBED_CONCURRENCY;
        const batchSize = options?.embedBatchSize ?? EMBED_BATCH_SIZE;
        const maxFileSize = options?.maxFileSize;
        const signal = options?.signal;

        cache.status.phase = "scanning";
        cache.status.message = "Scanning files...";
        onProgress?.(this.toStatus(cache));

        cache.runningIndex = (async () => {
            try {
                await this.ensurePersistedLoaded(cache);

                const candidates = await scanDirectory(cache.folderPath, {
                    includeExtensions: config.includeExtensions,
                    excludeFolders: config.excludeFolders,
                    maxFileSize,
                });

                if (signal?.aborted) {
                    throw signal.reason ?? new DOMException("Aborted", "AbortError");
                }

                const currentFiles = new Set(candidates.map((f) => f.relativePath));
                let changedIndex = false;

                cache.status.totalFiles = candidates.length;
                cache.status.filesToEmbed = 0;
                cache.status.skippedUnchanged = 0;
                cache.status.phase = "embedding";
                cache.status.message = "Preparing embeddings...";
                onProgress?.(this.toStatus(cache));

                // Remove deleted files
                for (const existingFilePath of Array.from(cache.fileStates.keys())) {
                    if (!currentFiles.has(existingFilePath)) {
                        const state = cache.fileStates.get(existingFilePath);
                        if (state) {
                            for (const chunkId of state.chunkIds) {
                                cache.chunks.delete(chunkId);
                            }
                        }
                        cache.fileStates.delete(existingFilePath);
                        changedIndex = true;
                    }
                }

                // Detect changed files
                const changedFiles: CandidateFile[] = [];
                for (const file of candidates) {
                    const previous = cache.fileStates.get(file.relativePath);
                    if (previous && previous.modifiedAt === file.modifiedAt && previous.size === file.size) {
                        cache.status.skippedUnchanged += 1;
                        continue;
                    }
                    changedFiles.push(file);
                }

                // Content-hash check for files that changed metadata but not content
                const filesToProcess: Array<{ file: CandidateFile; content: string; contentHash: string }> = [];
                for (const file of changedFiles) {
                    const content = await readFile(file.fullPath, "utf-8");
                    const contentHash = computeContentHash(content);
                    const previous = cache.fileStates.get(file.relativePath);
                    if (previous && previous.contentHash && previous.contentHash === contentHash) {
                        cache.fileStates.set(file.relativePath, {
                            ...previous,
                            modifiedAt: file.modifiedAt,
                            size: file.size,
                        });
                        cache.status.skippedUnchanged += 1;
                        continue;
                    }
                    filesToProcess.push({ file, content, contentHash });
                }

                cache.status.filesToEmbed = filesToProcess.length;
                cache.status.embeddedFiles = 0;
                onProgress?.(this.toStatus(cache));

                if (filesToProcess.length > 0) {
                    changedIndex = true;
                }

                // Chunk and embed changed files
                await runWithConcurrency(filesToProcess, concurrency, async ({ file, content, contentHash }) => {
                    if (signal?.aborted) {
                        throw signal.reason ?? new DOMException("Aborted", "AbortError");
                    }

                    const ext = extname(file.relativePath).toLowerCase();
                    const chunkResults = await this.codeChunker.chunk(content, { fileExtension: ext });
                    const texts = chunkResults.map((c) => c.content);

                    const vectors: number[][] = [];
                    for (let i = 0; i < texts.length; i += batchSize) {
                        if (signal?.aborted) {
                            throw signal.reason ?? new DOMException("Aborted", "AbortError");
                        }
                        const batch = texts.slice(i, i + batchSize);
                        const embedded = await this.embed(batch, { signal });
                        vectors.push(...embedded);
                    }

                    // Remove previous chunks for this file
                    const previousState = cache.fileStates.get(file.relativePath);
                    if (previousState) {
                        for (const chunkId of previousState.chunkIds) {
                            cache.chunks.delete(chunkId);
                        }
                    }

                    const fileChunkIds: string[] = [];
                    for (let i = 0; i < texts.length; i++) {
                        const vector = vectors[i];
                        if (!Array.isArray(vector)) continue;
                        const chunkId = `${file.relativePath}::${i}`;
                        fileChunkIds.push(chunkId);
                        cache.chunks.set(chunkId, {
                            id: chunkId,
                            filePath: file.relativePath,
                            modifiedAt: file.modifiedAt,
                            content: texts[i],
                            embedding: vector,
                            symbols: chunkResults[i].symbols,
                        });
                    }

                    cache.fileStates.set(file.relativePath, {
                        modifiedAt: file.modifiedAt,
                        size: file.size,
                        contentHash,
                        chunkIds: fileChunkIds,
                    });

                    cache.status.embeddedFiles += 1;
                    cache.status.totalChunks = cache.chunks.size;
                    cache.status.message = `Embedding ${cache.status.embeddedFiles}/${cache.status.filesToEmbed} files...`;
                    onProgress?.(this.toStatus(cache));
                }, signal);

                cache.status.phase = "ready";
                cache.status.totalChunks = cache.chunks.size;
                cache.status.lastIndexedAt = Date.now();
                cache.status.fileChangeDrift = 0;
                cache.status.driftAddedFiles = 0;
                cache.status.driftModifiedFiles = 0;
                cache.status.driftDeletedFiles = 0;
                cache.status.driftCheckedAt = Date.now();
                cache.status.message = "RAG index is ready";

                if (changedIndex) {
                    this.rebuildAnnIndex(cache);
                    cache.indexRevision += 1;
                    await saveToDisk(cache.folderPath, cache.chunks, cache.fileStates, cache.storagePath);
                }

                cache.status.dbSizeBytes = await getDbSizeBytes(cache.folderPath, cache.storagePath);
                return this.toStatus(cache);
            } catch (err) {
                if (err instanceof DOMException && err.name === "AbortError") {
                    cache.status.phase = "idle";
                    cache.status.message = "Indexing was cancelled";
                } else {
                    cache.status.phase = "error";
                    cache.status.message = err instanceof Error ? err.message : "Failed to build RAG index";
                }
                return this.toStatus(cache);
            } finally {
                onProgress?.(this.toStatus(cache));
                cache.runningIndex = undefined;
            }
        })();

        return cache.runningIndex;
    }

    /**
     * Get the current indexing status for a folder.
     */
    async getStatus(folderPath: string): Promise<RagStatus> {
        const cache = this.ensureCache(folderPath);
        await this.refreshHealth(cache);
        return this.toStatus(cache);
    }

    /**
     * Get the list of currently cached folder paths.
     */
    getCachedFolders(): string[] {
        return Array.from(this.caches.keys()).sort();
    }

    /**
     * Clear the RAG index and persisted data for a folder.
     */
    async clearFolder(folderPath: string, outputFolder?: string): Promise<void> {
        const normalized = normalizeFolderPath(folderPath);
        const storagePath = outputFolder ? normalizeFolderPath(outputFolder) : undefined;
        this.caches.delete(normalized);
        await clearStorage(normalized, storagePath);
    }

    /**
     * Get the internal folder cache. Used by {@link CodebaseSearcher}.
     * @internal
     */
    getCache(folderPath: string): FolderCache | undefined {
        return this.caches.get(normalizeFolderPath(folderPath));
    }

    /**
     * Ensure persisted data is loaded for a folder. Used by {@link CodebaseSearcher}.
     * @internal
     */
    async ensureLoaded(folderPath: string, storagePath?: string): Promise<FolderCache> {
        const cache = this.ensureCache(folderPath);
        if (storagePath) {
            cache.storagePath = normalizeFolderPath(storagePath);
        }
        await this.ensurePersistedLoaded(cache);
        return cache;
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    private ensureCache(folderPathInput: string): FolderCache {
        const folderPath = normalizeFolderPath(folderPathInput);
        const existing = this.caches.get(folderPath);
        if (existing) return existing;

        const config: RagFolderConfig = {
            enabled: false,
            includeExtensions: [...DEFAULT_INCLUDE_EXTENSIONS],
            excludeFolders: [...DEFAULT_SKIP_FOLDERS],
        };

        const status: RagStatus = {
            folderPath,
            enabled: false,
            phase: "idle",
            totalFiles: 0,
            filesToEmbed: 0,
            embeddedFiles: 0,
            skippedUnchanged: 0,
            totalChunks: 0,
            dbSizeBytes: 0,
            staleWarning: false,
            staleAgeMs: 0,
            staleThresholdMs: STALE_INDEX_THRESHOLD_MS,
            fileChangeDrift: 0,
            driftAddedFiles: 0,
            driftModifiedFiles: 0,
            driftDeletedFiles: 0,
            includeExtensions: config.includeExtensions,
            excludeFolders: config.excludeFolders,
            cachedFolders: [],
        };

        const cache: FolderCache = {
            folderPath,
            config,
            status,
            chunks: new Map(),
            fileStates: new Map(),
            persistedLoaded: false,
            queryEmbeddingCache: new Map(),
            queryResultCache: new Map(),
            indexRevision: 0,
        };

        this.caches.set(folderPath, cache);
        return cache;
    }

    private async ensurePersistedLoaded(cache: FolderCache): Promise<void> {
        if (cache.persistedLoaded) return;

        try {
            const loaded = await loadFromDisk(cache.folderPath, cache.storagePath);
            cache.chunks = loaded.chunks;
            cache.fileStates = loaded.fileStates;
            if (loaded.lastIndexedAt) {
                cache.status.lastIndexedAt = loaded.lastIndexedAt;
            }
        } catch {
            cache.chunks.clear();
            cache.fileStates.clear();
        } finally {
            cache.persistedLoaded = true;
            cache.status.totalChunks = cache.chunks.size;
            cache.status.dbSizeBytes = await getDbSizeBytes(cache.folderPath, cache.storagePath);
            this.rebuildAnnIndex(cache);
        }
    }

    private rebuildAnnIndex(cache: FolderCache): void {
        cache.annIndex = this.lsh.build(cache.chunks);
    }

    private toStatus(cache: FolderCache): RagStatus {
        this.updateStaleness(cache.status);
        return {
            ...cache.status,
            includeExtensions: [...cache.config.includeExtensions],
            excludeFolders: [...cache.config.excludeFolders],
            cachedFolders: this.getCachedFolders(),
        };
    }

    private updateStaleness(status: RagStatus): void {
        const now = Date.now();
        const ageMs = status.lastIndexedAt ? Math.max(0, now - status.lastIndexedAt) : 0;
        status.staleAgeMs = ageMs;
        status.staleThresholdMs = STALE_INDEX_THRESHOLD_MS;
        status.staleWarning = Boolean(status.lastIndexedAt) && ageMs >= STALE_INDEX_THRESHOLD_MS;
    }

    private async refreshHealth(cache: FolderCache): Promise<void> {
        await this.ensurePersistedLoaded(cache);
        this.updateStaleness(cache.status);

        if (!cache.config.enabled || cache.status.phase === "scanning" || cache.status.phase === "embedding") {
            cache.status.fileChangeDrift = 0;
            cache.status.driftAddedFiles = 0;
            cache.status.driftModifiedFiles = 0;
            cache.status.driftDeletedFiles = 0;
            cache.status.driftCheckedAt = Date.now();
            return;
        }

        const now = Date.now();
        if (cache.runningHealthRefresh) {
            await cache.runningHealthRefresh;
            return;
        }

        if (cache.status.driftCheckedAt && now - cache.status.driftCheckedAt < HEALTH_REFRESH_INTERVAL_MS) {
            return;
        }

        cache.runningHealthRefresh = (async () => {
            try {
                const candidates = await scanDirectory(cache.folderPath, {
                    includeExtensions: cache.config.includeExtensions,
                    excludeFolders: cache.config.excludeFolders,
                });
                const currentFilePaths = new Set(candidates.map((file) => file.relativePath));

                let driftAddedFiles = 0;
                let driftModifiedFiles = 0;
                let driftDeletedFiles = 0;

                for (const file of candidates) {
                    const previous = cache.fileStates.get(file.relativePath);
                    if (!previous) {
                        driftAddedFiles += 1;
                        continue;
                    }
                    if (previous.modifiedAt !== file.modifiedAt || previous.size !== file.size) {
                        driftModifiedFiles += 1;
                    }
                }

                for (const trackedFilePath of cache.fileStates.keys()) {
                    if (!currentFilePaths.has(trackedFilePath)) {
                        driftDeletedFiles += 1;
                    }
                }

                cache.status.fileChangeDrift = driftAddedFiles + driftModifiedFiles + driftDeletedFiles;
                cache.status.driftAddedFiles = driftAddedFiles;
                cache.status.driftModifiedFiles = driftModifiedFiles;
                cache.status.driftDeletedFiles = driftDeletedFiles;
                cache.status.driftCheckedAt = Date.now();
                cache.status.totalFiles = candidates.length;
            } catch {
                cache.status.fileChangeDrift = 0;
                cache.status.driftAddedFiles = 0;
                cache.status.driftModifiedFiles = 0;
                cache.status.driftDeletedFiles = 0;
                cache.status.driftCheckedAt = Date.now();
            } finally {
                cache.runningHealthRefresh = undefined;
            }
        })();

        await cache.runningHealthRefresh;
    }
}
