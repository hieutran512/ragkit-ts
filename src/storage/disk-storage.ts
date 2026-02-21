import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import {
    RAG_STORAGE_DIR,
    RAG_DB_FILE,
    RAG_INDEX_FILE,
    RAG_DB_VERSION,
    RAG_INDEX_VERSION,
} from "../defaults.js";
import type { RagChunk, RagFileState, PersistedRagDb, PersistedRagIndex } from "../types.js";

export interface LoadResult {
    chunks: Map<string, RagChunk>;
    fileStates: Map<string, RagFileState>;
    lastIndexedAt?: number;
}

function getPaths(folderPath: string) {
    const ragDir = join(folderPath, RAG_STORAGE_DIR);
    return {
        ragDir,
        dbPath: join(ragDir, RAG_DB_FILE),
        indexPath: join(ragDir, RAG_INDEX_FILE),
    };
}

/**
 * Load persisted RAG data from the `.rag/` directory inside a project folder.
 * Returns empty maps if no data exists or the data is corrupt.
 */
export async function loadFromDisk(folderPath: string): Promise<LoadResult> {
    const { dbPath, indexPath } = getPaths(folderPath);
    const chunks = new Map<string, RagChunk>();
    const fileStates = new Map<string, RagFileState>();
    let lastIndexedAt: number | undefined;

    try {
        const [rawDb, rawIndex] = await Promise.all([
            readFile(dbPath, "utf-8").catch(() => ""),
            readFile(indexPath, "utf-8").catch(() => ""),
        ]);

        if (rawDb) {
            const parsedDb = JSON.parse(rawDb) as PersistedRagDb;
            if (parsedDb.version === RAG_DB_VERSION && Array.isArray(parsedDb.chunks)) {
                for (const chunk of parsedDb.chunks) {
                    if (!chunk || !chunk.id || !Array.isArray(chunk.embedding)) continue;
                    chunks.set(chunk.id, chunk);
                }
            }
        }

        if (rawIndex) {
            const parsedIndex = JSON.parse(rawIndex) as PersistedRagIndex;
            if (
                parsedIndex.version === RAG_INDEX_VERSION &&
                parsedIndex.files &&
                typeof parsedIndex.files === "object"
            ) {
                for (const [filePath, state] of Object.entries(parsedIndex.files)) {
                    if (!state || typeof state.modifiedAt !== "number" || !Array.isArray(state.chunkIds)) continue;
                    fileStates.set(filePath, {
                        modifiedAt: state.modifiedAt,
                        size: typeof state.size === "number" ? state.size : -1,
                        contentHash: typeof state.contentHash === "string" ? state.contentHash : "",
                        chunkIds: state.chunkIds.filter((id) => typeof id === "string"),
                    });
                }

                if (typeof parsedIndex.updatedAt === "number" && Number.isFinite(parsedIndex.updatedAt)) {
                    lastIndexedAt = parsedIndex.updatedAt;
                }
            }
        }
    } catch {
        chunks.clear();
        fileStates.clear();
    }

    return { chunks, fileStates, lastIndexedAt };
}

/**
 * Persist RAG data to the `.rag/` directory inside a project folder.
 */
export async function saveToDisk(
    folderPath: string,
    chunks: Map<string, RagChunk>,
    fileStates: Map<string, RagFileState>,
): Promise<void> {
    const { ragDir, dbPath, indexPath } = getPaths(folderPath);
    await mkdir(ragDir, { recursive: true });

    const dbPayload: PersistedRagDb = {
        version: RAG_DB_VERSION,
        chunks: Array.from(chunks.values()),
    };

    const indexPayload: PersistedRagIndex = {
        version: RAG_INDEX_VERSION,
        updatedAt: Date.now(),
        files: Object.fromEntries(fileStates.entries()),
    };

    await Promise.all([
        writeFile(dbPath, JSON.stringify(dbPayload), "utf-8"),
        writeFile(indexPath, JSON.stringify(indexPayload), "utf-8"),
    ]);
}

/**
 * Get the size of the persisted DB file in bytes.
 */
export async function getDbSizeBytes(folderPath: string): Promise<number> {
    const { dbPath } = getPaths(folderPath);
    try {
        const st = await stat(dbPath);
        return st.size;
    } catch {
        return 0;
    }
}

/**
 * Remove the `.rag/` directory from a project folder.
 */
export async function clearStorage(folderPath: string): Promise<void> {
    const { ragDir } = getPaths(folderPath);
    try {
        await rm(ragDir, { recursive: true, force: true });
    } catch {
        // Best effort cleanup.
    }
}
