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
            let end = Math.min(clean.length, start + this.chunkSize);

            // Try to break at a newline boundary to avoid splitting mid-identifier
            if (end < clean.length) {
                const searchStart = Math.max(start, end - Math.floor(this.chunkSize * 0.2));
                const lastNewline = clean.lastIndexOf("\n", end);
                if (lastNewline >= searchStart) {
                    end = lastNewline + 1;
                }
            }

            const text = clean.slice(start, end).trim();
            if (text) {
                results.push({ content: text });
            }
            if (end >= clean.length) break;
            start = Math.max(start + 1, end - this.chunkOverlap);
        }

        return results;
    }
}
