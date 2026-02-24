import { CHUNK_SIZE, CHUNK_OVERLAP, MIN_CHUNK_SIZE } from "../defaults.js";
import type { ChunkResult, ChunkingOptions, CodeSymbol } from "../types.js";
import { getGrammarForExtension } from "./languages.js";
import { TextChunker } from "./text-chunker.js";
import { extractSymbols as extractTreeSitterSymbols, getProfile, type CodeSymbol as TreeSitterCodeSymbol } from "tree-sitter-ts";

interface SymbolSpan {
    symbol: CodeSymbol;
    startIndex: number;
    endIndex: number;
}

function clampOffset(offset: number, sourceLength: number): number {
    if (!Number.isFinite(offset)) return 0;
    return Math.max(0, Math.min(Math.trunc(offset), sourceLength));
}

function normalizeSymbolKind(
    kind: string,
): CodeSymbol["kind"] {
    switch (kind) {
        case "function":
        case "class":
        case "method":
        case "interface":
        case "type":
        case "enum":
        case "module":
        case "variable":
        case "import":
        case "export":
            return kind;
        default:
            return "other";
    }
}

function extractSymbolsFromTreeSitterTs(source: string, language: string): SymbolSpan[] {
    const symbols: TreeSitterCodeSymbol[] = extractTreeSitterSymbols(source, language);
    if (symbols.length === 0) return [];

    const ordered = symbols
        .slice()
        .sort((left, right) => {
            const startDiff = left.contentRange.start.offset - right.contentRange.start.offset;
            if (startDiff !== 0) return startDiff;
            return left.contentRange.end.offset - right.contentRange.end.offset;
        });

    const spans: SymbolSpan[] = [];
    let lastEndIndex = 0;

    for (const symbol of ordered) {
        const startIndex = clampOffset(symbol.contentRange.start.offset, source.length);
        const endIndex = clampOffset(symbol.contentRange.end.offset, source.length);
        if (endIndex <= startIndex) continue;

        const clampedStart = Math.max(startIndex, lastEndIndex);
        if (endIndex <= clampedStart) continue;

        spans.push({
            symbol: {
                name: symbol.name?.trim() || `<${symbol.kind}>`,
                kind: normalizeSymbolKind(symbol.kind),
                nameRange: symbol.nameRange,
                contentRange: symbol.contentRange,
            },
            startIndex: clampedStart,
            endIndex,
        });
        lastEndIndex = endIndex;
    }

    return spans;
}

/**
 * AST-aware code chunker that uses tree-sitter to respect symbol boundaries.
 *
 * When a supported language grammar is available, chunks are aligned to
 * top-level symbol boundaries (functions, classes, etc.). Symbols that exceed
 * the chunk size are sub-chunked with overlap. Unsupported languages fall back
 * to plain text chunking.
 */
export class CodeChunker {
    private chunkSize: number;
    private chunkOverlap: number;
    private textChunker: TextChunker;

    constructor(options?: ChunkingOptions) {
        this.chunkSize = options?.chunkSize ?? CHUNK_SIZE;
        this.chunkOverlap = options?.chunkOverlap ?? CHUNK_OVERLAP;
        this.textChunker = new TextChunker({ chunkSize: this.chunkSize, chunkOverlap: this.chunkOverlap });
    }

    /**
     * Chunk source code with AST awareness when possible.
     * Falls back to text chunking for unsupported languages.
     */
    async chunk(content: string, options?: { fileExtension?: string }): Promise<ChunkResult[]> {
        const ext = options?.fileExtension?.toLowerCase();
        if (!ext) return this.textChunker.chunk(content);

        const grammar = getGrammarForExtension(ext) ?? ext;
        const language = getProfile(ext) ? ext : (getProfile(grammar) ? grammar : undefined);
        if (!language) return this.textChunker.chunk(content);

        return this.chunkWithAst(content, language);
    }

    private async chunkWithAst(content: string, language: string): Promise<ChunkResult[]> {
        let spans: SymbolSpan[] = [];
        try {
            spans = extractSymbolsFromTreeSitterTs(content, language);
        } catch {
            return this.textChunker.chunk(content);
        }

        if (spans.length === 0) {
            return this.textChunker.chunk(content);
        }

        const results: ChunkResult[] = [];
        let pendingContent = "";
        let pendingSymbols: CodeSymbol[] = [];
        let cursor = 0;

        const flushPending = () => {
            if (!pendingContent.trim()) {
                pendingContent = "";
                pendingSymbols = [];
                return;
            }
            // If accumulated content exceeds chunk size, sub-chunk it
            if (pendingContent.length > this.chunkSize) {
                const subChunks = this.textChunker.chunk(pendingContent);
                for (const sub of subChunks) {
                    results.push({
                        content: sub.content,
                        symbols: pendingSymbols.length > 0 ? [...pendingSymbols] : undefined,
                    });
                }
            } else {
                results.push({
                    content: pendingContent.trim(),
                    symbols: pendingSymbols.length > 0 ? [...pendingSymbols] : undefined,
                });
            }
            pendingContent = "";
            pendingSymbols = [];
        };

        const appendToPending = (text: string) => {
            if (pendingContent.length > 0) {
                pendingContent += "\n" + text;
            } else {
                pendingContent = text;
            }
        };

        for (const span of spans) {
            // Include gap text between previous cursor and this symbol
            if (span.startIndex > cursor) {
                const gap = content.slice(cursor, span.startIndex).trim();
                if (gap) {
                    // If adding gap would exceed chunk size, flush first
                    if (pendingContent.length > 0 && pendingContent.length + gap.length + 1 > this.chunkSize) {
                        flushPending();
                    }
                    appendToPending(gap);
                }
            }

            const symbolText = content.slice(span.startIndex, span.endIndex);
            if (!symbolText.trim()) {
                cursor = Math.max(cursor, span.endIndex);
                continue;
            }

            // If adding this symbol would exceed chunk size, flush first
            if (pendingContent.length > 0 && pendingContent.length + symbolText.length + 1 > this.chunkSize) {
                flushPending();
            }

            appendToPending(symbolText);
            pendingSymbols.push(span.symbol);
            cursor = Math.max(cursor, span.endIndex);
        }

        // Flush remaining
        flushPending();

        // Cover trailing content after the last symbol
        if (cursor < content.length) {
            const trailing = content.slice(cursor).trim();
            if (trailing) {
                const chunks = this.textChunker.chunk(trailing);
                for (const chunk of chunks) {
                    results.push({ content: chunk.content });
                }
            }
        }

        // If we produced nothing (unlikely), fall back
        if (results.length === 0) {
            return this.textChunker.chunk(content);
        }

        return this.mergeSmallChunks(results);
    }

    private mergeSmallChunks(chunks: ChunkResult[]): ChunkResult[] {
        if (chunks.length <= 1) return chunks;

        const merged: ChunkResult[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (chunk.content.length >= MIN_CHUNK_SIZE || merged.length === 0) {
                merged.push({ ...chunk });
                continue;
            }
            // Merge small chunk into the previous one
            const prev = merged[merged.length - 1];
            prev.content = prev.content + "\n" + chunk.content;
            if (chunk.symbols) {
                prev.symbols = [...(prev.symbols || []), ...chunk.symbols];
            }
        }

        // If the last chunk is still too small and there's a previous one, merge backward
        if (merged.length > 1 && merged[merged.length - 1].content.length < MIN_CHUNK_SIZE) {
            const last = merged.pop()!;
            const prev = merged[merged.length - 1];
            prev.content = prev.content + "\n" + last.content;
            if (last.symbols) {
                prev.symbols = [...(prev.symbols || []), ...last.symbols];
            }
        }

        return merged;
    }
}
