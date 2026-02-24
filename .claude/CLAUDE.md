# CLAUDE.md

## Project Overview

**ragkit-ts** — A TypeScript library for code and document context extraction for AI agents. Provides chunking, symbol extraction (via tree-sitter), embedding, and vector search for codebases. Published to npm as `ragkit-ts`.

## Tech Stack

- **Language**: TypeScript (strict mode, ES2022 target)
- **Module system**: ESM (`"type": "module"`) with CJS dual build
- **Runtime**: Node.js >= 18
- **Build**: tsup (outputs ESM + CJS + `.d.ts` to `dist/`)
- **Test**: Vitest (tests in `tests/` directory)
- **Key dependency**: `tree-sitter-ts` for AST-based code parsing

## Project Structure

```
src/
  index.ts            # Public API re-exports
  types.ts            # All shared type definitions
  defaults.ts         # Constants and default configuration
  chunking/           # Text and code chunking (TextChunker, CodeChunker)
  embedding/          # Embedding adapters (Ollama, OpenAI-compatible)
  vector/             # Similarity search and LSH approximate nearest neighbor
  scanner/            # File system scanning
  storage/            # Disk persistence (.rag-ts directory)
  cache/              # LRU cache implementation
  indexer/             # CodebaseIndexer (orchestrates scan → chunk → embed)
  search/             # CodebaseSearcher (query → vector search → results)
tests/                # Mirrors src/ structure, *.test.ts files
```

## Commands

- `npm run build` — Build with tsup
- `npm test` — Run tests (`vitest run`)
- `npm run test:watch` — Watch mode tests
- `npm run test:coverage` — Tests with coverage
- `npm run typecheck` — TypeScript type checking (`tsc --noEmit`)

## Code Conventions

- Use `.js` extensions in import paths (required for ESM — e.g., `import { Foo } from "./foo.js"`)
- All types live in `src/types.ts`; constants/defaults in `src/defaults.ts`
- Public API is exported through `src/index.ts` — update it when adding new exports
- Tests go in `tests/<module>/` matching the `src/` structure
- No formatter/linter config in repo — follow existing code style (4-space indentation, double quotes)

## Architecture Notes

- **EmbedFunction**: `(texts: string[]) => Promise<number[][]>` — user-provided or via built-in adapters
- **Indexing pipeline**: scan files → chunk (text or AST-based) → batch embed → persist to disk
- **Search pipeline**: embed query → LSH ANN pre-filter → cosine similarity rerank → return top-K
- **Storage**: persisted as `.rag-db` (chunks) and `.rag-index` (file states) inside `.rag-ts/` directory
