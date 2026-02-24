import { describe, expect, it } from "vitest";
import {
    getGrammarForExtension,
    getSymbolNodeTypes,
    nodeTypeToSymbolKind,
} from "../../src/chunking/languages.js";

describe("language mappings", () => {
    it("maps extensions to grammars case-insensitively", () => {
        expect(getGrammarForExtension(".TS")).toBe("typescript");
        expect(getGrammarForExtension(".jsx")).toBe("javascript");
        expect(getGrammarForExtension(".unknown")).toBeUndefined();
    });

    it("returns symbol node types for supported grammars", () => {
        const typescriptNodes = getSymbolNodeTypes("typescript");
        expect(typescriptNodes).toContain("function_declaration");
        expect(getSymbolNodeTypes("nonexistent")).toEqual([]);
    });

    it("normalizes node type to symbol kind", () => {
        expect(nodeTypeToSymbolKind("function_declaration")).toBe("function");
        expect(nodeTypeToSymbolKind("class_declaration")).toBe("class");
        expect(nodeTypeToSymbolKind("interface_declaration")).toBe("interface");
        expect(nodeTypeToSymbolKind("enum_declaration")).toBe("enum");
        expect(nodeTypeToSymbolKind("import_statement")).toBe("import");
        expect(nodeTypeToSymbolKind("unknown_node")).toBe("other");
    });
});
