import { describe, expect, it } from "vitest";
import { TextChunker } from "../../src/chunking/text-chunker.js";

describe("TextChunker", () => {
    it("returns empty array for empty/whitespace content", () => {
        const chunker = new TextChunker({ chunkSize: 10, chunkOverlap: 2 });

        expect(chunker.chunk("   \n\r\n  ")).toEqual([]);
    });

    it("normalizes CRLF and trims boundaries", () => {
        const chunker = new TextChunker({ chunkSize: 100, chunkOverlap: 10 });
        const chunks = chunker.chunk("\r\n  hello\r\nworld  \r\n");

        expect(chunks).toHaveLength(1);
        expect(chunks[0].content).toBe("hello\nworld");
    });

    it("creates overlapping chunks", () => {
        const chunker = new TextChunker({ chunkSize: 6, chunkOverlap: 2 });
        const chunks = chunker.chunk("abcdefghijklmnopqrstuvwxyz");

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0].content).toBe("abcdef");
        expect(chunks[1].content.startsWith("ef")).toBe(true);
    });
});
