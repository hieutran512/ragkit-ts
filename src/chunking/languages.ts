/**
 * Maps file extensions to language/profile identifiers used by tree-sitter-ts.
 */
export const EXTENSION_TO_GRAMMAR: Record<string, string> = {
    // JSON
    ".json": "json",

    // CSS / SCSS
    ".css": "css",
    ".scss": "scss",

    // TypeScript
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "typescript",

    // JavaScript
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",

    // Python
    ".py": "python",
    ".pyi": "python",
    ".pyw": "python",

    // Go
    ".go": "go",

    // Java
    ".java": "java",

    // C++
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".hh": "cpp",
    ".cxx": "cpp",
    ".hxx": "cpp",
    ".h": "cpp",

    // C#
    ".cs": "c_sharp",
    ".csx": "c_sharp",

    // Rust
    ".rs": "rust",

    // Ruby
    ".rb": "ruby",
    ".rake": "ruby",
    ".gemspec": "ruby",

    // PHP
    ".php": "php",
    ".phtml": "php",
    ".php8": "php",

    // Swift
    ".swift": "swift",

    // Kotlin
    ".kt": "kotlin",
    ".kts": "kotlin",

    // Shell
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".ksh": "bash",

    // HTML / Markdown
    ".html": "html",
    ".htm": "html",
    ".md": "markdown",
    ".markdown": "markdown",
    ".mdx": "markdown",

    // YAML / XML / SQL / TOML
    ".yaml": "yaml",
    ".yml": "yaml",
    ".xml": "xml",
    ".xsd": "xml",
    ".xsl": "xml",
    ".xslt": "xml",
    ".svg": "xml",
    ".sql": "sql",
    ".toml": "toml",
};

/**
 * Tree-sitter node types that represent top-level "symbols" worth preserving
 * as chunk boundaries. Keyed by grammar name.
 */
export const SYMBOL_NODE_TYPES: Record<string, string[]> = {
    typescript: [
        "function_declaration",
        "class_declaration",
        "interface_declaration",
        "type_alias_declaration",
        "enum_declaration",
        "export_statement",
        "import_statement",
        "lexical_declaration",
        "variable_declaration",
        "method_definition",
        "abstract_class_declaration",
    ],
    javascript: [
        "function_declaration",
        "class_declaration",
        "export_statement",
        "import_statement",
        "lexical_declaration",
        "variable_declaration",
        "method_definition",
    ],
    python: [
        "function_definition",
        "class_definition",
        "decorated_definition",
        "import_statement",
        "import_from_statement",
        "assignment",
    ],
    go: [
        "function_declaration",
        "method_declaration",
        "type_declaration",
        "import_declaration",
        "var_declaration",
        "const_declaration",
    ],
    java: [
        "class_declaration",
        "interface_declaration",
        "enum_declaration",
        "method_declaration",
        "constructor_declaration",
        "import_declaration",
        "field_declaration",
    ],
    cpp: [
        "function_definition",
        "declaration",
        "class_specifier",
        "struct_specifier",
        "enum_specifier",
        "namespace_definition",
        "template_declaration",
        "preproc_include",
        "preproc_def",
    ],
    csharp: [
        "class_declaration",
        "interface_declaration",
        "struct_declaration",
        "enum_declaration",
        "method_declaration",
        "constructor_declaration",
        "property_declaration",
        "namespace_declaration",
        "using_directive",
    ],
    rust: [
        "function_item",
        "struct_item",
        "enum_item",
        "impl_item",
        "trait_item",
        "mod_item",
        "use_declaration",
        "const_item",
        "static_item",
        "type_item",
    ],
    ruby: [
        "method",
        "class",
        "module",
        "singleton_method",
        "call",
        "assignment",
    ],
    php: [
        "function_definition",
        "class_declaration",
        "interface_declaration",
        "trait_declaration",
        "method_declaration",
        "namespace_definition",
        "use_declaration",
    ],
    swift: [
        "function_declaration",
        "class_declaration",
        "struct_declaration",
        "enum_declaration",
        "protocol_declaration",
        "import_declaration",
        "property_declaration",
    ],
    kotlin: [
        "function_declaration",
        "class_declaration",
        "object_declaration",
        "interface_declaration",
        "property_declaration",
        "import_header",
    ],
    shell: [
        "function_definition",
        "variable_assignment",
        "command",
    ],
};

/**
 * Map a tree-sitter node type to a normalized symbol kind.
 */
export function nodeTypeToSymbolKind(nodeType: string): "function" | "class" | "method" | "interface" | "type" | "enum" | "module" | "variable" | "import" | "export" | "other" {
    if (nodeType.includes("function") || nodeType.includes("method") || nodeType === "singleton_method") return "function";
    if (nodeType.includes("class") || nodeType.includes("struct")) return "class";
    if (nodeType.includes("interface") || nodeType.includes("protocol") || nodeType.includes("trait")) return "interface";
    if (nodeType.includes("type") && !nodeType.includes("type_definition")) return "type";
    if (nodeType.includes("enum")) return "enum";
    if (nodeType.includes("module") || nodeType.includes("namespace") || nodeType === "mod_item") return "module";
    if (nodeType.includes("import") || nodeType.includes("using") || nodeType === "use_declaration" || nodeType === "preproc_include") return "import";
    if (nodeType.includes("export")) return "export";
    if (nodeType.includes("variable") || nodeType.includes("lexical") || nodeType.includes("assignment") || nodeType.includes("const") || nodeType.includes("static") || nodeType.includes("property") || nodeType === "declaration" || nodeType === "field_declaration") return "variable";
    return "other";
}

/**
 * Returns the grammar name for a given file extension, or undefined if unsupported.
 */
export function getGrammarForExtension(ext: string): string | undefined {
    return EXTENSION_TO_GRAMMAR[ext.toLowerCase()];
}

/**
 * Returns the symbol node types for a given grammar name.
 */
export function getSymbolNodeTypes(grammar: string): string[] {
    return SYMBOL_NODE_TYPES[grammar] ?? [];
}
