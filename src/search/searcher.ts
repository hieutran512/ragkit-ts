import {
    TOP_K,
    QUERY_CACHE_TTL_MS,
    QUERY_EMBED_CACHE_MAX,
    QUERY_RESULT_CACHE_MAX,
    QUERY_RESULT_CACHE_TOP_K,
} from "../defaults.js";
import type {
    EmbedFunction,
    FolderCache,
    RagChunk,
    RagSearchResult,
    SearchOptions,
} from "../types.js";
import { LruCache } from "../cache/lru-cache.js";
import { LshIndex } from "../vector/lsh.js";
import { cosineSimilarity } from "../vector/similarity.js";
import type { CodebaseIndexer } from "../indexer/indexer.js";

function normalizeQuery(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

interface CachedRanking {
    chunkIds: string[];
    scores: number[];
    revision: number;
}

/**
 * Searches an indexed codebase using vector similarity.
 *
 * Uses the ANN index for fast candidate retrieval, then re-ranks by exact
 * cosine similarity. Results are cached with TTL for repeated queries.
 *
 * @example
 * ```ts
 * const searcher = new CodebaseSearcher({ embed: createOllamaEmbed(), indexer });
 * const results = await searcher.search("/path/to/project", "auth middleware");
 * ```
 */
export class CodebaseSearcher {
    private embed: EmbedFunction;
    private indexer: CodebaseIndexer;
    private lsh = new LshIndex();
    private embeddingCache = new LruCache<number[]>(QUERY_EMBED_CACHE_MAX, QUERY_CACHE_TTL_MS);
    private resultCache = new LruCache<CachedRanking>(QUERY_RESULT_CACHE_MAX, QUERY_CACHE_TTL_MS);

    constructor(options: { embed: EmbedFunction; indexer: CodebaseIndexer }) {
        this.embed = options.embed;
        this.indexer = options.indexer;
    }

    /**
     * Search the indexed codebase for chunks matching the query.
     */
    async search(folderPath: string, query: string, options?: SearchOptions): Promise<RagSearchResult> {
        const startedAt = performance.now();
        const cache = await this.indexer.ensureLoaded(folderPath);
        const topK = options?.topK ?? TOP_K;

        if (!cache.config.enabled || cache.chunks.size === 0) {
            return this.emptyResult(cache, query, startedAt);
        }

        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            return this.emptyResult(cache, query, startedAt);
        }

        const ranked = await this.getRankedChunks(cache, trimmedQuery, Math.max(1, topK));

        const matches = ranked.map((item) => ({
            filePath: item.chunk.filePath,
            score: Math.round(item.score * 1000) / 1000,
            content: item.chunk.content,
        }));

        return {
            folderPath: cache.folderPath,
            query,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            totalChunks: cache.chunks.size,
            matches,
        };
    }

    /**
     * Get RAG context as a formatted string for injection into LLM prompts.
     */
    async getContextForQuery(folderPath: string, query: string): Promise<string> {
        const cache = await this.indexer.ensureLoaded(folderPath);
        if (!cache.config.enabled || cache.chunks.size === 0 || !query.trim()) return "";

        const ranked = await this.getRankedChunks(cache, query, TOP_K);
        if (ranked.length === 0) return "";

        const lines: string[] = [
            "## RAG Context (project files)",
            "Use the following snippets as additional project context when relevant:",
            "",
        ];

        for (const item of ranked) {
            lines.push(`### ${item.chunk.filePath}`);
            lines.push(item.chunk.content);
            lines.push("");
        }

        return lines.join("\n").trim();
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    private async getRankedChunks(
        cache: FolderCache,
        rawQuery: string,
        topK: number,
    ): Promise<Array<{ chunk: RagChunk; score: number }>> {
        const queryKey = normalizeQuery(rawQuery);
        if (!queryKey) return [];

        // Check result cache
        const cachedResult = this.resultCache.get(queryKey);
        if (
            cachedResult &&
            cachedResult.revision === cache.indexRevision &&
            cachedResult.chunkIds.length >= topK
        ) {
            const cachedRanked: Array<{ chunk: RagChunk; score: number }> = [];
            for (let i = 0; i < Math.min(topK, cachedResult.chunkIds.length); i++) {
                const chunk = cache.chunks.get(cachedResult.chunkIds[i]);
                if (!chunk) continue;
                cachedRanked.push({ chunk, score: cachedResult.scores[i] });
            }
            return cachedRanked;
        }

        // Get query embedding (cached)
        const queryEmbedding = await this.getQueryEmbedding(queryKey, rawQuery.trim());
        if (!queryEmbedding) return [];

        // ANN search → fallback to brute force
        const annCandidates = cache.annIndex
            ? this.lsh.query(cache.annIndex, queryEmbedding, cache.chunks)
            : null;
        const searchPool = annCandidates ?? Array.from(cache.chunks.values());

        const cacheTopK = Math.max(topK, QUERY_RESULT_CACHE_TOP_K);
        const ranked = searchPool
            .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, cacheTopK);

        // Cache the result
        this.resultCache.set(queryKey, {
            chunkIds: ranked.map((item) => item.chunk.id),
            scores: ranked.map((item) => item.score),
            revision: cache.indexRevision,
        });

        return ranked.slice(0, topK);
    }

    private async getQueryEmbedding(queryKey: string, query: string): Promise<number[] | undefined> {
        const cached = this.embeddingCache.get(queryKey);
        if (cached) return cached;

        const [embedded] = await this.embed([query]);
        if (!embedded) return undefined;

        this.embeddingCache.set(queryKey, embedded);
        return embedded;
    }

    private emptyResult(cache: FolderCache, query: string, startedAt: number): RagSearchResult {
        return {
            folderPath: cache.folderPath,
            query,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            totalChunks: cache.chunks.size,
            matches: [],
        };
    }
}
