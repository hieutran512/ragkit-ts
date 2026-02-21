/**
 * Options for creating an Ollama embedding function.
 */
export interface OllamaEmbedOptions {
    /** Ollama server URL. Default: "http://localhost:11434" */
    baseUrl?: string;
    /** Embedding model name. Default: "nomic-embed-text" */
    model?: string;
}

/**
 * Options for creating an OpenAI-compatible embedding function.
 */
export interface OpenAICompatibleEmbedOptions {
    /** Base URL of the API server. Default: "http://localhost:1234" */
    baseUrl?: string;
    /** API path for embeddings. Default: "/v1/embeddings" */
    endpointPath?: string;
    /** Model name sent in embedding requests. Default: "nomic-embed-text-v1.5" */
    model?: string;
    /** Optional API key sent as `Authorization: Bearer <apiKey>`. */
    apiKey?: string;
    /** Additional request headers. */
    headers?: Record<string, string>;
}
