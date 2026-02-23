import { describe, expect, it } from "@jest/globals";
import { CodeChunker } from "../../src/chunking/code-chunker.js";

describe("CodeChunker", () => {
    it("uses symbol contentRange/nameRange metadata for AST chunks", async () => {
        const source = [
            "const preamble = 1;",
            "",
            "function alpha() {",
            "  return preamble + 1;",
            "}",
            "",
            "function beta() {",
            "  return alpha();",
            "}",
        ].join("\n");

        const chunker = new CodeChunker({ chunkSize: 120, chunkOverlap: 20 });
        const chunks = await chunker.chunk(source, { fileExtension: ".ts" });

        expect(chunks.length).toBeGreaterThan(0);

        const symbolChunk = chunks.find((chunk) => chunk.symbols && chunk.symbols.length > 0);
        expect(symbolChunk).toBeDefined();

        const symbol = symbolChunk!.symbols![0];
        expect(symbol.contentRange.start.offset).toBeGreaterThanOrEqual(0);
        expect(symbol.contentRange.end.offset).toBeGreaterThan(symbol.contentRange.start.offset);
        expect(symbol.nameRange.start.line).toBeGreaterThan(0);

        const symbolSource = source.slice(symbol.contentRange.start.offset, symbol.contentRange.end.offset);
        expect(symbolSource.trim().length).toBeGreaterThan(0);
        expect(symbolSource).toContain(symbol.name);
    });

    it("keeps trailing non-symbol content in output", async () => {
        const source = [
            "function alpha() {",
            "  return 1;",
            "}",
            "",
            "const trailing = alpha();",
        ].join("\n");

        const chunker = new CodeChunker({ chunkSize: 80, chunkOverlap: 10 });
        const chunks = await chunker.chunk(source, { fileExtension: ".ts" });
        console.log("chunks:", JSON.stringify(chunks, null, 2));

        expect(chunks.some((chunk) => chunk.content.includes("const trailing"))).toBe(true);
    });
});
