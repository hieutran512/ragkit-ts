import { CHUNK_SIZE, CHUNK_OVERLAP } from "../defaults.js";
import type { ChunkResult, ChunkingOptions, CodeSymbol } from "../types.js";
import { getGrammarForExtension } from "./languages.js";
import { TextChunker } from "./text-chunker.js";
import { extractSymbols as extractTreeSitterSymbols, getProfile, type CodeSymbol as TreeSitterCodeSymbol } from "tree-sitter-ts";

interface SymbolSpan {
    symbol: CodeSymbol;
    startIndex: number;
    endIndex: number;
}

function lineStartOffsets(source: string): number[] {
    const offsets = [0];
    for (let index = 0; index < source.length; index++) {
        if (source[index] === "\n") {
            offsets.push(index + 1);
        }
    }
    return offsets;
}

function toIndexFromLine(line: number, offsets: number[], sourceLength: number): number {
    if (line <= 1) return 0;
    const offsetIndex = Math.min(Math.max(0, line - 1), offsets.length - 1);
    const candidate = offsets[offsetIndex];
    if (typeof candidate === "number") return candidate;
    return sourceLength;
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

    const offsets = lineStartOffsets(source);
    const ordered = symbols
        .slice()
        .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);

    const spans: SymbolSpan[] = [];
    let lastEndIndex = 0;

    for (const symbol of ordered) {
        const startIndex = toIndexFromLine(symbol.startLine, offsets, source.length);
        const endIndex = toIndexFromLine(symbol.endLine + 1, offsets, source.length);
        if (endIndex <= startIndex) continue;

        const clampedStart = Math.max(startIndex, lastEndIndex);
        if (endIndex <= clampedStart) continue;

        spans.push({
            symbol: {
                name: symbol.name?.trim() || `<${symbol.kind}>`,
                kind: normalizeSymbolKind(symbol.kind),
                startLine: symbol.startLine,
                endLine: symbol.endLine,
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

        // Cover any content before the first symbol
        if (spans.length > 0 && spans[0].startIndex > 0) {
            const preamble = content.slice(0, spans[0].startIndex).trim();
            if (preamble) {
                pendingContent = preamble;
            }
        }

        for (const span of spans) {
            const symbolText = content.slice(span.startIndex, span.endIndex);

            // If adding this symbol would exceed chunk size, flush first
            if (pendingContent.length > 0 && pendingContent.length + symbolText.length + 1 > this.chunkSize) {
                flushPending();
            }

            if (pendingContent.length > 0) {
                pendingContent += "\n" + symbolText;
            } else {
                pendingContent = symbolText;
            }
            pendingSymbols.push(span.symbol);
        }

        // Flush remaining
        flushPending();

        // If we produced nothing (unlikely), fall back
        if (results.length === 0) {
            return this.textChunker.chunk(content);
        }

        return results;
    }
}
