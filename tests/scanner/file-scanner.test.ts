import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { scanDirectory } from "../../src/scanner/file-scanner.js";

describe("scanDirectory", () => {
    let root = "";

    afterEach(async () => {
        if (root) {
            await rm(root, { recursive: true, force: true });
            root = "";
        }
    });

    it("includes allowed extensions and skips excluded folders/files", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-scan-"));
        await mkdir(join(root, "src"), { recursive: true });
        await mkdir(join(root, "node_modules"), { recursive: true });

        await writeFile(join(root, "src", "main.ts"), "export const x = 1;");
        await writeFile(join(root, "src", "skip.js"), "console.log('x');");
        await writeFile(join(root, "package-lock.json"), "{}");
        await writeFile(join(root, "node_modules", "lib.ts"), "export const y = 2;");

        const files = await scanDirectory(root, {
            includeExtensions: [".ts"],
            excludeFolders: ["node_modules"],
        });

        expect(files).toHaveLength(1);
        expect(files[0].relativePath).toBe("src/main.ts");
        expect(files[0].size).toBeGreaterThan(0);
    });

    it("skips files larger than maxFileSize", async () => {
        root = await mkdtemp(join(tmpdir(), "rag-ts-scan-"));
        await mkdir(join(root, "src"), { recursive: true });

        await writeFile(join(root, "src", "small.ts"), "ok");
        await writeFile(join(root, "src", "large.ts"), "x".repeat(128));

        const files = await scanDirectory(root, {
            includeExtensions: [".ts"],
            maxFileSize: 16,
            excludeFolders: [],
            skipFiles: [],
        });

        expect(files.map((f) => f.relativePath)).toEqual(["src/small.ts"]);
    });
});
