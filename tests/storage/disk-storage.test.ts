import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { clearStorage, getDbSizeBytes, loadFromDisk, saveToDisk } from "../../src/storage/disk-storage.js";
import { RAG_DB_FILE, RAG_INDEX_FILE, RAG_STORAGE_DIR } from "../../src/defaults.js";
import type { RagChunk, RagFileState } from "../../src/types.js";

describe("disk storage", () => {
    let root = "";

    afterEach(async () => {
        if (root) {
            await rm(root, { recursive: true, force: true });
            root = "";
        }
    });

    it("saves and loads chunks/file states", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-store-"));

        const chunks = new Map<string, RagChunk>([
            [
                "id-1",
                {
                    id: "id-1",
                    filePath: "a.ts",
                    modifiedAt: 1,
                    content: "hello",
                    embedding: [1, 2, 3],
                },
            ],
        ]);

        const states = new Map<string, RagFileState>([
            [
                "a.ts",
                {
                    modifiedAt: 1,
                    size: 5,
                    contentHash: "abc",
                    chunkIds: ["id-1"],
                },
            ],
        ]);

        await saveToDisk(root, chunks, states);

        const loaded = await loadFromDisk(root);
        expect(loaded.chunks.size).toBe(1);
        expect(loaded.fileStates.size).toBe(1);
        expect(loaded.chunks.get("id-1")?.content).toBe("hello");

        const dbSize = await getDbSizeBytes(root);
        expect(dbSize).toBeGreaterThan(0);
    });

    it("returns empty maps for corrupt persisted JSON", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-store-"));
        const ragDir = join(root, RAG_STORAGE_DIR);

        await writeFile(join(ragDir, RAG_DB_FILE), "{ broken", "utf-8").catch(async () => {
            // Create folder if first write fails due missing path
            const { mkdir } = await import("fs/promises");
            await mkdir(ragDir, { recursive: true });
            await writeFile(join(ragDir, RAG_DB_FILE), "{ broken", "utf-8");
        });
        await writeFile(join(ragDir, RAG_INDEX_FILE), "{ broken", "utf-8");

        const loaded = await loadFromDisk(root);
        expect(loaded.chunks.size).toBe(0);
        expect(loaded.fileStates.size).toBe(0);
    });

    it("clears storage directory", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-store-"));

        await saveToDisk(root, new Map(), new Map());
        await clearStorage(root);

        const loaded = await loadFromDisk(root);
        expect(loaded.chunks.size).toBe(0);

        const size = await getDbSizeBytes(root);
        expect(size).toBe(0);

        const ragPath = join(root, RAG_STORAGE_DIR, RAG_DB_FILE);
        await expect(readFile(ragPath, "utf-8")).rejects.toThrow();
    });
});
