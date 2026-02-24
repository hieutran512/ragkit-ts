import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "../../src/vector/similarity.js";
import { LshIndex } from "../../src/vector/lsh.js";
import type { RagChunk } from "../../src/types.js";

describe("vector utilities", () => {
    it("computes cosine similarity and handles invalid inputs", () => {
        expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
        expect(cosineSimilarity([], [1])).toBe(-1);
        expect(cosineSimilarity([1], [1, 2])).toBe(-1);
        expect(cosineSimilarity([0, 0], [1, 0])).toBe(-1);
    });

    it("builds LSH index and returns query candidates", () => {
        const lsh = new LshIndex({ projectionDim: 8, maxHammingDistance: 0, fallbackMinCandidates: 1 });
        const chunks = new Map<string, RagChunk>([
            [
                "c1",
                { id: "c1", filePath: "a.ts", modifiedAt: 1, content: "A", embedding: [1, 0, 0] },
            ],
            [
                "c2",
                { id: "c2", filePath: "b.ts", modifiedAt: 1, content: "B", embedding: [0, 1, 0] },
            ],
        ]);

        const index = lsh.build(chunks);
        expect(index).toBeDefined();

        const result = lsh.query(index!, [1, 0, 0], chunks);
        expect(result).not.toBeNull();
        expect(result!.some((chunk) => chunk.id === "c1")).toBe(true);
    });

    it("falls back when dimensions mismatch or candidate count too low", () => {
        const chunks = new Map<string, RagChunk>([
            ["x", { id: "x", filePath: "x.ts", modifiedAt: 1, content: "X", embedding: [1, 2] }],
        ]);

        const strict = new LshIndex({ projectionDim: 6, maxHammingDistance: 0, fallbackMinCandidates: 2 });
        const index = strict.build(chunks)!;

        expect(strict.query(index, [1, 2, 3], chunks)).toBeNull();
        expect(strict.query(index, [1, 2], chunks)).toBeNull();
    });

    it("ranks candidates by positive cosine score", () => {
        const lsh = new LshIndex();
        const candidates: RagChunk[] = [
            { id: "a", filePath: "a", modifiedAt: 1, content: "A", embedding: [1, 0] },
            { id: "b", filePath: "b", modifiedAt: 1, content: "B", embedding: [0.5, 0.5] },
            { id: "c", filePath: "c", modifiedAt: 1, content: "C", embedding: [-1, 0] },
        ];

        const ranked = lsh.rank(candidates, [1, 0], 3);
        expect(ranked.map((item) => item.chunk.id)).toEqual(["a", "b"]);
        expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    });
});
