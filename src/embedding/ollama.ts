import type { EmbedFunction, EmbedOptions } from "../types.js";
import type { OllamaEmbedOptions } from "./types.js";

/**
 * Creates an {@link EmbedFunction} that uses the Ollama API.
 *
 * Tries the batch `/api/embed` endpoint first, then falls back to the
 * single-prompt `/api/embeddings` endpoint for older Ollama versions.
 *
 * @example
 * ```ts
 * const embed = createOllamaEmbed({ baseUrl: "http://localhost:11434", model: "nomic-embed-text" });
 * const vectors = await embed(["hello world", "how are you"]);
 * ```
 */
export function createOllamaEmbed(options?: OllamaEmbedOptions): EmbedFunction {
    const baseUrl = (options?.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    const model = options?.model ?? "nomic-embed-text";

    return async (input: string[], embedOptions?: EmbedOptions): Promise<number[][]> => {
        if (input.length === 0) return [];
        const signal = embedOptions?.signal;

        // Try batch endpoint first
        const batchResponse = await fetch(`${baseUrl}/api/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, input }),
            signal,
        });

        if (batchResponse.ok) {
            const parsed = (await batchResponse.json()) as { embeddings?: number[][] };
            if (Array.isArray(parsed.embeddings) && parsed.embeddings.length === input.length) {
                return parsed.embeddings;
            }
        }

        // Fallback to single-prompt endpoint
        const vectors: number[][] = [];
        for (const text of input) {
            const response = await fetch(`${baseUrl}/api/embeddings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model, prompt: text }),
                signal,
            });

            if (!response.ok) {
                throw new Error(`Embedding failed: ${response.status} ${response.statusText}`);
            }

            const parsed = (await response.json()) as { embedding?: number[] };
            if (!Array.isArray(parsed.embedding)) {
                throw new Error("Embedding response missing vector data");
            }
            vectors.push(parsed.embedding);
        }

        return vectors;
    };
}
