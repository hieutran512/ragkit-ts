import {
    ANN_PROJECTION_DIM,
    ANN_MAX_HAMMING_DISTANCE,
    ANN_FALLBACK_MIN_CANDIDATES,
    ANN_MAX_RERANK_CANDIDATES,
} from "../defaults.js";
import type { LshAnnIndex, RagChunk } from "../types.js";
import { cosineSimilarity } from "./similarity.js";

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
    let t = seed;
    return () => {
        t += 0x6d2b79f5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Random projection matrix
// ---------------------------------------------------------------------------

function createProjection(dimensions: number, projectionDim: number): number[][] {
    const rand = mulberry32(dimensions * 73856093 + projectionDim * 19349663);
    const matrix: number[][] = [];
    for (let i = 0; i < projectionDim; i++) {
        const row = new Array<number>(dimensions);
        for (let j = 0; j < dimensions; j++) {
            row[j] = rand() * 2 - 1;
        }
        matrix.push(row);
    }
    return matrix;
}

// ---------------------------------------------------------------------------
// Signature & distance helpers
// ---------------------------------------------------------------------------

function signatureForEmbedding(embedding: number[], projection: number[][]): string {
    const bits: string[] = [];
    for (const row of projection) {
        let dot = 0;
        for (let i = 0; i < embedding.length; i++) {
            dot += embedding[i] * row[i];
        }
        bits.push(dot >= 0 ? "1" : "0");
    }
    return bits.join("");
}

function hammingDistance(a: string, b: string): number {
    if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) distance += 1;
    }
    return distance;
}

function flipSignatureBits(signature: string, indices: number[]): string {
    const chars = signature.split("");
    for (const index of indices) {
        chars[index] = chars[index] === "1" ? "0" : "1";
    }
    return chars.join("");
}

function buildNearbySignatures(signature: string, maxDistance: number): string[] {
    const variants = new Set<string>([signature]);
    const length = signature.length;

    if (maxDistance >= 1) {
        for (let i = 0; i < length; i++) {
            variants.add(flipSignatureBits(signature, [i]));
        }
    }

    if (maxDistance >= 2) {
        for (let i = 0; i < length; i++) {
            for (let j = i + 1; j < length; j++) {
                variants.add(flipSignatureBits(signature, [i, j]));
            }
        }
    }

    return Array.from(variants.values());
}

// ---------------------------------------------------------------------------
// LshIndex — Locality-Sensitive Hashing for approximate nearest neighbors
// ---------------------------------------------------------------------------

export interface LshOptions {
    projectionDim?: number;
    maxHammingDistance?: number;
    fallbackMinCandidates?: number;
    maxRerankCandidates?: number;
}

/**
 * An LSH-based approximate nearest neighbor index.
 *
 * Uses random projections to hash high-dimensional embeddings into binary
 * signatures. Nearby signatures (within a Hamming distance threshold)
 * are used to quickly narrow down candidates before exact cosine re-ranking.
 */
export class LshIndex {
    private projectionDim: number;
    private maxHammingDistance: number;
    private fallbackMinCandidates: number;
    private maxRerankCandidates: number;

    constructor(options?: LshOptions) {
        this.projectionDim = options?.projectionDim ?? ANN_PROJECTION_DIM;
        this.maxHammingDistance = options?.maxHammingDistance ?? ANN_MAX_HAMMING_DISTANCE;
        this.fallbackMinCandidates = options?.fallbackMinCandidates ?? ANN_FALLBACK_MIN_CANDIDATES;
        this.maxRerankCandidates = options?.maxRerankCandidates ?? ANN_MAX_RERANK_CANDIDATES;
    }

    /**
     * Build an LSH index from a collection of chunks.
     * Returns undefined if the collection is empty or has no valid embeddings.
     */
    build(chunks: Map<string, RagChunk>): LshAnnIndex | undefined {
        if (chunks.size === 0) return undefined;

        const firstChunk = chunks.values().next().value as RagChunk | undefined;
        if (!firstChunk || firstChunk.embedding.length === 0) return undefined;

        const dimensions = firstChunk.embedding.length;
        const projection = createProjection(dimensions, this.projectionDim);
        const buckets = new Map<string, string[]>();

        for (const chunk of chunks.values()) {
            if (chunk.embedding.length !== dimensions) continue;
            const signature = signatureForEmbedding(chunk.embedding, projection);
            const existing = buckets.get(signature);
            if (existing) {
                existing.push(chunk.id);
            } else {
                buckets.set(signature, [chunk.id]);
            }
        }

        return { dimensions, projection, buckets };
    }

    /**
     * Query the ANN index for candidate chunks near the given embedding.
     * Returns null if there are too few candidates (caller should fall back to brute force).
     */
    query(index: LshAnnIndex, queryEmbedding: number[], chunks: Map<string, RagChunk>): RagChunk[] | null {
        if (index.dimensions !== queryEmbedding.length) return null;

        const querySignature = signatureForEmbedding(queryEmbedding, index.projection);
        const nearby = buildNearbySignatures(querySignature, this.maxHammingDistance);
        const candidatesById = new Set<string>();

        for (const candidateSignature of nearby) {
            if (hammingDistance(querySignature, candidateSignature) > this.maxHammingDistance) continue;
            const ids = index.buckets.get(candidateSignature);
            if (!ids) continue;
            for (const id of ids) {
                candidatesById.add(id);
                if (candidatesById.size >= this.maxRerankCandidates) break;
            }
            if (candidatesById.size >= this.maxRerankCandidates) break;
        }

        if (candidatesById.size < this.fallbackMinCandidates) return null;

        const candidates: RagChunk[] = [];
        for (const id of candidatesById) {
            const chunk = chunks.get(id);
            if (chunk) candidates.push(chunk);
        }

        return candidates;
    }

    /**
     * Rank candidate chunks by cosine similarity to the query embedding.
     */
    rank(candidates: RagChunk[], queryEmbedding: number[], topK: number): Array<{ chunk: RagChunk; score: number }> {
        return candidates
            .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }
}
