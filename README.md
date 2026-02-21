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
- **Good defaults**: sensible chunking, search, and storage behavior.
- **Consumer-friendly API**: index, search, and prompt-context generation in a few calls.

## Architecture 

This package (`ragkit-ts`) uses a **local, file-based index** stored under your project folder.

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
- **Index size** (`dbSizeBytes`): on-disk storage cost of your `.rag/` data.

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

Example: log embedding/file/chunk/size stats during indexing.

```ts
import { CodebaseIndexer, createOllamaEmbed } from "ragkit-ts";

const folderPath = "c:/projects/my-app";
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

### CodebaseSearcher

```ts
const searcher = new CodebaseSearcher({ embed, indexer });

const result = await searcher.search(folderPath, "jwt validation", { topK: 6 });
const context = await searcher.getContextForQuery(folderPath, "jwt validation");
```

### Embeddings

Built-in Ollama adapter:

```ts
import { createOllamaEmbed } from "ragkit-ts";

const embed = createOllamaEmbed({
  baseUrl: "http://localhost:11434", // optional
  model: "nomic-embed-text", // optional
});
```

Built-in OpenAI-compatible adapter (works with many local tools exposing `/v1/embeddings`, e.g. LM Studio, LocalAI, or vLLM-compatible gateways):

```ts
import { createOpenAICompatibleEmbed } from "ragkit-ts";

const embed = createOpenAICompatibleEmbed({
  baseUrl: "http://localhost:1234", // optional
  model: "nomic-embed-text-v1.5", // optional
  // apiKey: process.env.OPENAI_API_KEY, // optional
});
```

Custom provider:

```ts
import type { EmbedFunction } from "ragkit-ts";

const embed: EmbedFunction = async (texts) => {
  // return one numeric vector per input text
  return texts.map(() => [0.1, 0.2, 0.3]);
};
```

## Output shape

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

## Notes

- Index data is persisted under a `.rag/` folder in the target project.
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

await indexer.index("c:/projects/knowledge-base", {
  includeExtensions: [".kb", ".md", ".ts"],
});
```

### Example B: developer provides a new custom profile

```ts
import {
  registerProfile,
  type LanguageProfile,
} from "tree-sitter-ts";
import {
  CodebaseIndexer,
  createOllamaEmbed,
  EXTENSION_TO_GRAMMAR,
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

await indexer.index("c:/projects/toy-service", {
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
