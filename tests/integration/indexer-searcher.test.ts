import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { CodebaseIndexer } from "../../src/indexer/indexer.js";
import { CodebaseSearcher } from "../../src/search/searcher.js";
import { RAG_DB_FILE, RAG_STORAGE_DIR } from "../../src/defaults.js";
import type { EmbedFunction } from "../../src/types.js";

function embedText(text: string): number[] {
    const normalized = text.toLowerCase();
    const alpha = normalized.includes("alpha") ? 1 : 0;
    const beta = normalized.includes("beta") ? 1 : 0;
    const gamma = normalized.includes("gamma") ? 1 : 0;
    const len = normalized.length / 100;
    return [alpha, beta, gamma, len];
}

const mockEmbed: EmbedFunction = async (texts) => texts.map(embedText);

describe("CodebaseIndexer + CodebaseSearcher", () => {
    let root = "";
    let outputDir = "";

    afterEach(async () => {
        if (root) {
            await rm(root, { recursive: true, force: true });
            root = "";
        }
        if (outputDir) {
            await rm(outputDir, { recursive: true, force: true });
            outputDir = "";
        }
    });

    it("indexes files, persists data, and supports incremental reindex", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-index-"));
        await mkdir(join(root, "docs"), { recursive: true });

        const filePath = join(root, "docs", "a.md");
        await writeFile(filePath, "alpha content and context", "utf-8");

        const indexer = new CodebaseIndexer({ embed: mockEmbed });

        const first = await indexer.index(root, { includeExtensions: [".md"], excludeFolders: [] });
        expect(first.phase).toBe("ready");
        expect(first.totalFiles).toBe(1);
        expect(first.totalChunks).toBeGreaterThan(0);

        const dbFile = join(root, RAG_STORAGE_DIR, RAG_DB_FILE);
        await expect(readFile(dbFile, "utf-8")).resolves.toContain("alpha content");

        await new Promise((resolve) => setTimeout(resolve, 20));
        await writeFile(filePath, "alpha content and context", "utf-8");

        const second = await indexer.index(root, { includeExtensions: [".md"], excludeFolders: [] });
        expect(second.phase).toBe("ready");
        expect(second.skippedUnchanged).toBeGreaterThanOrEqual(1);

        await indexer.clearFolder(root);
        await expect(readFile(dbFile, "utf-8")).rejects.toThrow();
    });

    it("searches indexed chunks and builds context output", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-search-"));
        await mkdir(join(root, "docs"), { recursive: true });

        await writeFile(join(root, "docs", "alpha.md"), "alpha system architecture", "utf-8");
        await writeFile(join(root, "docs", "beta.md"), "beta deployment notes", "utf-8");

        const indexer = new CodebaseIndexer({ embed: mockEmbed });
        await indexer.index(root, { includeExtensions: [".md"], excludeFolders: [] });

        const searcher = new CodebaseSearcher({ embed: mockEmbed, indexer });

        const empty = await searcher.search(root, "   ");
        expect(empty.matches).toEqual([]);

        const result = await searcher.search(root, "alpha", { topK: 1 });
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].filePath).toBe("docs/alpha.md");
        expect(result.matches[0].score).toBeGreaterThan(0);

        const context = await searcher.getContextForQuery(root, "alpha");
        expect(context).toContain("## RAG Context");
        expect(context).toContain("docs/alpha.md");
    });

    it("stops indexing when signal is aborted", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-abort-"));
        await mkdir(join(root, "docs"), { recursive: true });
        for (let i = 0; i < 10; i++) {
            await writeFile(join(root, "docs", `file${i}.md`), `content ${i} alpha beta`, "utf-8");
        }

        const controller = new AbortController();
        let embedCallCount = 0;
        const slowEmbed: EmbedFunction = async (texts) => {
            embedCallCount++;
            if (embedCallCount >= 2) controller.abort();
            return texts.map(embedText);
        };

        const indexer = new CodebaseIndexer({ embed: slowEmbed });
        const status = await indexer.index(root, {
            includeExtensions: [".md"],
            excludeFolders: [],
            signal: controller.signal,
            concurrency: 1,
        });

        expect(status.phase).toBe("idle");
        expect(status.message).toContain("cancelled");
    });

    it("indexes to a separate output folder and searches from it", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-src-"));
        outputDir = await mkdtemp(join(tmpdir(), "rag-ts-out-"));
        await mkdir(join(root, "docs"), { recursive: true });

        await writeFile(join(root, "docs", "alpha.md"), "alpha system architecture", "utf-8");
        await writeFile(join(root, "docs", "beta.md"), "beta deployment notes", "utf-8");

        const indexer = new CodebaseIndexer({ embed: mockEmbed });
        const status = await indexer.index(root, {
            includeExtensions: [".md"],
            excludeFolders: [],
            outputFolder: outputDir,
        });

        expect(status.phase).toBe("ready");

        // Verify .rag-ts exists in outputDir, not root
        const dbInOutput = join(outputDir, RAG_STORAGE_DIR, RAG_DB_FILE);
        const dbInSource = join(root, RAG_STORAGE_DIR, RAG_DB_FILE);
        await expect(readFile(dbInOutput, "utf-8")).resolves.toContain("alpha");
        await expect(readFile(dbInSource, "utf-8")).rejects.toThrow();

        // Search using the outputFolder
        const searcher = new CodebaseSearcher({ embed: mockEmbed, indexer });
        const result = await searcher.search(root, "alpha", { topK: 1, outputFolder: outputDir });
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].filePath).toBe("docs/alpha.md");

        // clearFolder with outputFolder
        await indexer.clearFolder(root, outputDir);
        await expect(readFile(dbInOutput, "utf-8")).rejects.toThrow();
    });
});
