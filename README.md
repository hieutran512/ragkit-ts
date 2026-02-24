# ragkit-ts

TypeScript RAG toolkit for indexing and searching source code or documents.

`ragkit-ts` helps you:
- scan folders,
- chunk files (AST-aware for supported languages),
- generate embeddings,
- run semantic search,
- and reuse a persisted index across restarts.

## Why use it

- **Fast incremental indexing**: only changed files are re-embedded.
- **Pluggable embeddings**: use Ollama, OpenAI-compatible local APIs (LM Studio/LocalAI/vLLM-style), or your own provider.
- **Cancellable indexing**: pass an `AbortSignal` to stop long-running index jobs mid-operation.
- **Flexible storage**: persist the `.rag-ts/` index inside the source folder or a separate output directory.
- **Good defaults**: sensible chunking, search, and storage behavior.
- **Consumer-friendly API**: index, search, and prompt-context generation in a few calls.

## Architecture

This package (`ragkit-ts`) uses a **local, file-based index** stored under your project folder (or a custom output folder).

### Our approach (local file-based index)

**Pros**
- Very quick setup: no DB provisioning, migrations, or connection management.
- Works well for local tools, CI jobs, and per-repo workflows.
- Lower operational overhead for small/medium codebases.
- Easy to cache and move with project artifacts.

**Cons**
- Not ideal for many concurrent writers.
- Fewer built-in multi-tenant and centralized access patterns.
- Horizontal scaling requires extra architecture (sharding/services) outside the package.

### How to choose

Choose **`ragkit-ts` local index** when you want:
- fastest time-to-value,
- minimal infrastructure,
- repository-scoped indexing/search,
- and easy local/CI portability.

### What "medium codebase" means in practice

"Medium" is hard to define by raw repository size because many folders are not indexed (for example: `node_modules`, `dist`, generated files, media, docs-only folders).

For `ragkit-ts`, a better definition is based on the **indexed dataset**:

- **Indexed files** (`totalFiles`): files matched by `includeExtensions` and not removed by `excludeFolders`.
- **Indexed chunks** (`totalChunks`): the real retrieval workload after chunking.
- **Index size** (`dbSizeBytes`): on-disk storage cost of your `.rag-ts/` data.

Rule-of-thumb ranges (not hard limits):

- **Small**: up to ~2,000 indexed files, up to ~120,000 chunks, index under ~1 GB.
- **Medium**: ~2,000 to ~15,000 indexed files, ~120,000 to ~900,000 chunks, index ~1–8 GB.
- **Large**: above those ranges, or when indexing/search runs need service-level scaling and central coordination.

Use these as planning numbers; actual behavior depends on chunking settings, embedding dimension/model, and how much text each file produces.

Tip: run one full index and inspect `getStatus()` output (`totalFiles`, `totalChunks`, `dbSizeBytes`) to classify your project quickly instead of estimating lines of code manually.

## Requirements

- Node.js **18+**
- npm/pnpm/yarn
- An embedding provider (built-in Ollama or OpenAI-compatible adapter, or a custom function)

## Install

```bash
npm install ragkit-ts
```

## Quick start

```ts
import { CodebaseIndexer, CodebaseSearcher, createOllamaEmbed } from "ragkit-ts";

// 1) Create embedding function (Ollama adapter)
const embed = createOllamaEmbed({
  baseUrl: "http://localhost:11434",
  model: "nomic-embed-text",
});

// 2) Build/update index
const indexer = new CodebaseIndexer({ embed });
await indexer.index("/path/to/project", {
  includeExtensions: [".ts", ".tsx", ".js", ".md"],
  excludeFolders: ["node_modules", "dist", ".git"],
});

// 3) Search
const searcher = new CodebaseSearcher({ embed, indexer });
const result = await searcher.search("/path/to/project", "how auth middleware works", {
  topK: 5,
});

for (const match of result.matches) {
  console.log(match.filePath, match.score);
  console.log(match.content);
}
```

## Typical workflow

1. Create one `CodebaseIndexer` per embedding strategy.
2. Call `index()` when your project changes (safe to run repeatedly).
3. Use `CodebaseSearcher.search()` for ranked snippets.
4. Use `getContextForQuery()` to inject context into an LLM prompt.

## API overview

### CodebaseIndexer

```ts
const indexer = new CodebaseIndexer({ embed });

await indexer.index(folderPath, {
  includeExtensions: [".ts", ".js"],
  excludeFolders: ["node_modules"],
  concurrency: 2,
  embedBatchSize: 16,
  onProgress: (status) => console.log(status.phase, status.message),
});

const status = await indexer.getStatus(folderPath);
await indexer.clearFolder(folderPath);
```

#### Progress monitoring

Log embedding/file/chunk/size stats during indexing.

```ts
import { CodebaseIndexer, createOllamaEmbed } from "ragkit-ts";

const folderPath = "/projects/my-app";
const embed = createOllamaEmbed({ model: "nomic-embed-text" });
const indexer = new CodebaseIndexer({ embed });

await indexer.index(folderPath, {
  onProgress: (s) => {
    console.log(
      `[${s.phase}] embedded ${s.embeddedFiles}/${s.filesToEmbed} | total files ${s.totalFiles} | total chunks ${s.totalChunks} | rag db ${(s.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`,
    );
  },
});

const status = await indexer.getStatus(folderPath);
console.log({
  embeddedFiles: status.embeddedFiles,
  filesToEmbed: status.filesToEmbed,
  totalChunks: status.totalChunks,
  dbSizeBytes: status.dbSizeBytes,
});
```

#### Cancelling indexing with AbortSignal

Cancel a long-running indexing job mid-operation. When aborted, in-flight network requests are cancelled and no partial data is persisted.

```ts
import { CodebaseIndexer, createOllamaEmbed } from "ragkit-ts";

const embed = createOllamaEmbed();
const indexer = new CodebaseIndexer({ embed });

const controller = new AbortController();

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);

const status = await indexer.index("/projects/large-repo", {
  includeExtensions: [".ts", ".js", ".py"],
  signal: controller.signal,
});

if (status.phase === "idle" && status.message?.includes("cancelled")) {
  console.log("Indexing was cancelled before completion");
} else {
  console.log(`Indexing complete: ${status.totalChunks} chunks`);
}
```

You can also abort from a progress callback:

```ts
const controller = new AbortController();

await indexer.index("/projects/my-app", {
  signal: controller.signal,
  onProgress: (s) => {
    // Stop once we've embedded enough files
    if (s.embeddedFiles >= 100) {
      controller.abort();
    }
  },
});
```

#### Custom output folder

By default, the `.rag-ts/` storage directory is created inside the source folder being indexed. You can redirect it to a separate output directory instead.

```ts
import { CodebaseIndexer, CodebaseSearcher, createOllamaEmbed } from "ragkit-ts";

const embed = createOllamaEmbed();
const indexer = new CodebaseIndexer({ embed });

// Index source code, but store .rag-ts/ in a separate folder
await indexer.index("/projects/my-app", {
  includeExtensions: [".ts", ".js"],
  outputFolder: "/data/rag-indexes/my-app",
});

// Search using the same output folder
const searcher = new CodebaseSearcher({ embed, indexer });
const result = await searcher.search("/projects/my-app", "auth middleware", {
  topK: 5,
  outputFolder: "/data/rag-indexes/my-app",
});

for (const match of result.matches) {
  console.log(match.filePath, match.score);
}

// Get LLM context from the output folder
const context = await searcher.getContextForQuery(
  "/projects/my-app",
  "auth middleware",
  { outputFolder: "/data/rag-indexes/my-app" },
);

// Clear the index in the output folder
await indexer.clearFolder("/projects/my-app", "/data/rag-indexes/my-app");
```

This is useful when:
- You don't want to pollute the source repo with index files.
- The source folder is read-only (e.g., mounted volume, CI checkout).
- You want to store indexes in a shared or centralized location.

### CodebaseSearcher

```ts
const searcher = new CodebaseSearcher({ embed, indexer });

// Ranked search results
const result = await searcher.search(folderPath, "jwt validation", { topK: 6 });

for (const match of result.matches) {
  console.log(`${match.filePath} (score: ${match.score})`);
  console.log(match.content);
}

// Formatted context string for LLM prompts
const context = await searcher.getContextForQuery(folderPath, "jwt validation");
console.log(context);
// Output:
// ## RAG Context (project files)
// Use the following snippets as additional project context when relevant:
//
// ### src/auth/jwt.ts
// <chunk content>
```

### Embeddings

#### Ollama adapter

```ts
import { createOllamaEmbed } from "ragkit-ts";

const embed = createOllamaEmbed({
  baseUrl: "http://localhost:11434", // default
  model: "nomic-embed-text",        // default
});

const vectors = await embed(["hello world", "how are you"]);
// vectors: number[][] -- one vector per input text
```

#### OpenAI-compatible adapter

Works with any server exposing `/v1/embeddings` (LM Studio, LocalAI, vLLM, OpenAI, etc.):

```ts
import { createOpenAICompatibleEmbed } from "ragkit-ts";

const embed = createOpenAICompatibleEmbed({
  baseUrl: "http://localhost:1234",      // default
  endpointPath: "/v1/embeddings",        // default
  model: "nomic-embed-text-v1.5",        // default
  apiKey: process.env.OPENAI_API_KEY,    // optional -- sent as Bearer token
  headers: { "X-Custom-Header": "val" }, // optional
});
```

#### Custom embedding provider

Implement the `EmbedFunction` signature to use any provider:

```ts
import type { EmbedFunction } from "ragkit-ts";

// Simple custom provider
const embed: EmbedFunction = async (texts) => {
  const response = await fetch("https://my-api.com/embeddings", {
    method: "POST",
    body: JSON.stringify({ texts }),
  });
  const data = await response.json();
  return data.vectors; // number[][]
};

// AbortSignal is forwarded as the second argument (optional to handle)
const embedWithAbort: EmbedFunction = async (texts, options) => {
  const response = await fetch("https://my-api.com/embeddings", {
    method: "POST",
    body: JSON.stringify({ texts }),
    signal: options?.signal, // cancel in-flight requests on abort
  });
  const data = await response.json();
  return data.vectors;
};
```

### File scanning

Scan directories for candidate source files without indexing:

```ts
import { scanDirectory } from "ragkit-ts";

const files = await scanDirectory("/projects/my-app", {
  includeExtensions: [".ts", ".js", ".md"],
  excludeFolders: ["node_modules", "dist", ".git"],
  maxFileSize: 1_048_576, // 1 MB (default)
});

for (const file of files) {
  console.log(file.relativePath, file.size, file.modifiedAt);
}
```

### Chunking

#### Text chunking (baseline)

Splits text into overlapping fixed-size chunks:

```ts
import { TextChunker } from "ragkit-ts";

const chunker = new TextChunker({
  chunkSize: 1200,  // default
  chunkOverlap: 200, // default
});

const chunks = chunker.chunk("your file content here...");
for (const chunk of chunks) {
  console.log(chunk.content.length, chunk.content.slice(0, 50));
}
```

#### AST-aware code chunking

Respects symbol boundaries (functions, classes, etc.) for supported languages. Falls back to text chunking for unsupported languages:

```ts
import { CodeChunker } from "ragkit-ts";

const chunker = new CodeChunker({
  chunkSize: 1200,
  chunkOverlap: 200,
});

const chunks = await chunker.chunk(tsSourceCode, { fileExtension: ".ts" });
for (const chunk of chunks) {
  console.log(chunk.content.slice(0, 80));
  if (chunk.symbols) {
    for (const sym of chunk.symbols) {
      console.log(`  ${sym.kind}: ${sym.name}`);
    }
  }
}
```

### Vector utilities

#### Cosine similarity

```ts
import { cosineSimilarity } from "ragkit-ts";

const score = cosineSimilarity([1, 0, 0], [0.9, 0.1, 0]);
console.log(score); // ~0.994
```

#### LSH approximate nearest neighbor index

For fast candidate retrieval before exact cosine re-ranking:

```ts
import { LshIndex } from "ragkit-ts";

const lsh = new LshIndex({
  projectionDim: 16,           // default
  maxHammingDistance: 3,        // default
  fallbackMinCandidates: 32,   // default
  maxRerankCandidates: 1200,   // default
});

// Build index from a map of chunks
const annIndex = lsh.build(chunksMap);

// Query for candidates near a query embedding
const candidates = lsh.query(annIndex, queryEmbedding, chunksMap);
// Returns RagChunk[] or null (null = too few candidates, use brute force)

// Rank candidates by cosine similarity
const ranked = lsh.rank(candidates, queryEmbedding, 10);
for (const { chunk, score } of ranked) {
  console.log(chunk.filePath, score);
}
```

### Disk storage

Low-level persistence functions for direct access to the `.rag-ts/` storage:

```ts
import { saveToDisk, loadFromDisk, getDbSizeBytes, clearStorage } from "ragkit-ts";

// Save chunks and file states to disk
await saveToDisk(folderPath, chunksMap, fileStatesMap);

// Save to a custom output folder instead
await saveToDisk(folderPath, chunksMap, fileStatesMap, "/data/rag-output");

// Load persisted data
const { chunks, fileStates, lastIndexedAt } = await loadFromDisk(folderPath);

// Load from a custom output folder
const loaded = await loadFromDisk(folderPath, "/data/rag-output");

// Check index size
const sizeBytes = await getDbSizeBytes(folderPath);

// Remove index data
await clearStorage(folderPath);
```

### LRU cache

General-purpose LRU cache with optional TTL:

```ts
import { LruCache } from "ragkit-ts";

const cache = new LruCache<number[]>(128, 10 * 60 * 1000); // max 128 entries, 10-min TTL

cache.set("query-abc", [0.1, 0.2, 0.3]);
const value = cache.get("query-abc"); // number[] | undefined
console.log(cache.size);              // 1
cache.delete("query-abc");
cache.clear();
```

## Output shapes

`search()` returns:

```ts
{
  folderPath: string;
  query: string;
  durationMs: number;
  totalChunks: number;
  matches: Array<{
    filePath: string;
    score: number;
    content: string;
  }>;
}
```

`getStatus()` returns:

```ts
{
  folderPath: string;
  enabled: boolean;
  phase: "idle" | "scanning" | "embedding" | "ready" | "error";
  totalFiles: number;
  filesToEmbed: number;
  embeddedFiles: number;
  skippedUnchanged: number;
  totalChunks: number;
  dbSizeBytes: number;
  lastIndexedAt?: number;
  staleWarning: boolean;
  staleAgeMs: number;
  staleThresholdMs: number;
  fileChangeDrift: number;
  driftAddedFiles: number;
  driftModifiedFiles: number;
  driftDeletedFiles: number;
  driftCheckedAt?: number;
  message?: string;
  includeExtensions: string[];
  excludeFolders: string[];
  cachedFolders: string[];
}
```

## Notes

- Index data is persisted under a `.rag-ts/` folder (configurable via `outputFolder`).
- Unsupported languages gracefully fall back to text chunking.
- Package ships with ESM + CJS builds and TypeScript declarations.

## Custom language / extension support

Yes — custom file extensions are supported.

- If the extension resolves to a registered `tree-sitter-ts` profile, chunking is AST-aware.
- If not, indexing still works with text chunking fallback.

### Example A: map custom extension to an existing profile

```ts
import {
  CodebaseIndexer,
  createOllamaEmbed,
  EXTENSION_TO_GRAMMAR,
} from "ragkit-ts";

// Reuse built-in markdown profile for custom files.
EXTENSION_TO_GRAMMAR[".kb"] = "markdown";

const indexer = new CodebaseIndexer({
  embed: createOllamaEmbed({ model: "nomic-embed-text" }),
});

await indexer.index("/projects/knowledge-base", {
  includeExtensions: [".kb", ".md", ".ts"],
});
```

### Example B: developer provides a new custom profile

```ts
import { registerProfile } from "tree-sitter-ts";
import {
  CodebaseIndexer,
  createOllamaEmbed,
  EXTENSION_TO_GRAMMAR,
  type LanguageProfile,
} from "ragkit-ts";

const toyProfile: LanguageProfile = {
  name: "toylang",
  displayName: "Toy Language",
  version: "1.0.0",
  fileExtensions: [".toy"],
  lexer: {
    charClasses: {
      identStart: { union: [{ predefined: "letter" }, { chars: "_" }] },
      identPart: { union: [{ predefined: "alphanumeric" }, { chars: "_" }] },
    },
    tokenTypes: {
      keyword: { category: "keyword" },
      identifier: { category: "identifier" },
      punctuation: { category: "punctuation" },
      whitespace: { category: "whitespace" },
      newline: { category: "newline" },
    },
    initialState: "default",
    skipTokens: ["whitespace", "newline"],
    states: {
      default: {
        rules: [
          { match: { kind: "keywords", words: ["fn"] }, token: "keyword" },
          {
            match: {
              kind: "charSequence",
              first: { ref: "identStart" },
              rest: { ref: "identPart" },
            },
            token: "identifier",
          },
          {
            match: { kind: "string", value: ["{", "}", "(", ")", ",", ";"] },
            token: "punctuation",
          },
        ],
      },
    },
  },
  structure: {
    blocks: [{ name: "braces", open: "{", close: "}" }],
    symbols: [
      {
        name: "function_declaration",
        kind: "function",
        pattern: [
          { token: "keyword", value: "fn" },
          { token: "identifier", capture: "name" },
        ],
        hasBody: true,
        bodyStyle: "braces",
      },
    ],
  },
};

// 1) Register language profile in tree-sitter-ts
registerProfile(toyProfile);

// 2) Tell ragkit-ts which grammar/profile to use for this extension
EXTENSION_TO_GRAMMAR[".toy"] = "toylang";

// 3) Index files with your extension
const indexer = new CodebaseIndexer({
  embed: createOllamaEmbed({ model: "nomic-embed-text" }),
});

await indexer.index("/projects/toy-service", {
  includeExtensions: [".toy"],
});
```

If you only need indexing for an unknown extension, you can skip profile registration and just include it in `includeExtensions`; it will be chunked as plain text.

## For contributors

```bash
npm test
npm run test:watch
npm run test:coverage
```

## License

MIT
