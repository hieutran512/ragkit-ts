import type { EmbedFunction, EmbedOptions } from "../types.js";
import type { OpenAICompatibleEmbedOptions } from "./types.js";

interface OpenAICompatibleEmbeddingResponse {
    data?: Array<{ embedding?: number[]; index?: number }>;
}

/**
 * Creates an {@link EmbedFunction} for OpenAI-compatible embeddings APIs.
 *
 * Compatible with local servers exposing `/v1/embeddings`, such as
 * LM Studio, LocalAI, vLLM-compatible gateways, and similar tools.
 *
 * @example
 * ```ts
 * const embed = createOpenAICompatibleEmbed({
 *   baseUrl: "http://localhost:1234",
 *   model: "nomic-embed-text-v1.5",
 * });
 *
 * const vectors = await embed(["hello", "world"]);
 * ```
 */
export function createOpenAICompatibleEmbed(options?: OpenAICompatibleEmbedOptions): EmbedFunction {
    const baseUrl = (options?.baseUrl ?? "http://localhost:1234").replace(/\/+$/, "");
    const endpointPath = options?.endpointPath ?? "/v1/embeddings";
    const model = options?.model ?? "nomic-embed-text-v1.5";
    const apiKey = options?.apiKey;
    const headers = options?.headers;

    return async (input: string[], embedOptions?: EmbedOptions): Promise<number[][]> => {
        if (input.length === 0) return [];

        const requestHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            ...(headers ?? {}),
        };

        if (apiKey) {
            requestHeaders.Authorization = `Bearer ${apiKey}`;
        }

        const response = await fetch(`${baseUrl}${endpointPath}`, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({ model, input }),
            signal: embedOptions?.signal,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            const suffix = errorBody ? ` - ${errorBody}` : "";
            throw new Error(`Embedding failed: ${response.status} ${response.statusText}${suffix}`);
        }

        const parsed = (await response.json()) as OpenAICompatibleEmbeddingResponse;
        if (!Array.isArray(parsed.data)) {
            throw new Error("Embedding response missing data");
        }

        const ordered = [...parsed.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const vectors = ordered.map((item) => item.embedding);

        if (vectors.length !== input.length || vectors.some((vector) => !Array.isArray(vector))) {
            throw new Error("Embedding response has invalid vector data");
        }

        return vectors as number[][];
    };
}
