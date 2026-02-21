import { CHUNK_SIZE, CHUNK_OVERLAP } from "../defaults.js";
import type { ChunkResult, ChunkingOptions } from "../types.js";

/**
 * Splits text content into overlapping fixed-size chunks.
 * This is the baseline chunker — use {@link CodeChunker} for AST-aware chunking.
 */
export class TextChunker {
    private chunkSize: number;
    private chunkOverlap: number;

    constructor(options?: Pick<ChunkingOptions, "chunkSize" | "chunkOverlap">) {
        this.chunkSize = options?.chunkSize ?? CHUNK_SIZE;
        this.chunkOverlap = options?.chunkOverlap ?? CHUNK_OVERLAP;
    }

    chunk(content: string): ChunkResult[] {
        const clean = content.replace(/\r\n/g, "\n").trim();
        if (!clean) return [];

        const results: ChunkResult[] = [];
        let start = 0;

        while (start < clean.length) {
            const end = Math.min(clean.length, start + this.chunkSize);
            const text = clean.slice(start, end).trim();
            if (text) {
                results.push({ content: text });
            }
            if (end >= clean.length) break;
            start = Math.max(0, end - this.chunkOverlap);
        }

        return results;
    }
}
