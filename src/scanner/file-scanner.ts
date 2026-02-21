import { readdir, stat } from "fs/promises";
import { extname, join, relative } from "path";
import {
    MAX_FILE_BYTES,
    DEFAULT_SKIP_FOLDERS,
    DEFAULT_SKIP_FILES,
    DEFAULT_INCLUDE_EXTENSIONS,
} from "../defaults.js";
import type { CandidateFile } from "../types.js";

export interface ScanOptions {
    /** File extensions to include (e.g. [".ts", ".js"]). Default: all code extensions. */
    includeExtensions?: string[];
    /** Folder names to skip (e.g. ["node_modules", "dist"]). Default: common skip folders. */
    excludeFolders?: string[];
    /** File names to always skip. Default: lock files, OS files. */
    skipFiles?: string[];
    /** Maximum file size in bytes. Default: 1 MB. */
    maxFileSize?: number;
}

/**
 * Recursively scan a directory for candidate source files.
 *
 * Applies include/exclude filters and returns metadata for each matching file.
 */
export async function scanDirectory(
    folderPath: string,
    options?: ScanOptions,
): Promise<CandidateFile[]> {
    const includeExtensions = new Set(options?.includeExtensions ?? DEFAULT_INCLUDE_EXTENSIONS);
    const excludeFolders = new Set(options?.excludeFolders ?? DEFAULT_SKIP_FOLDERS);
    const skipFiles = new Set(options?.skipFiles ?? DEFAULT_SKIP_FILES);
    const maxFileSize = options?.maxFileSize ?? MAX_FILE_BYTES;

    const files: CandidateFile[] = [];

    async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (excludeFolders.has(entry.name)) continue;
                await walk(join(dir, entry.name));
                continue;
            }

            if (skipFiles.has(entry.name)) continue;

            const ext = extname(entry.name).toLowerCase();
            if (!includeExtensions.has(ext)) continue;

            const fullPath = join(dir, entry.name);
            const st = await stat(fullPath);
            if (st.size > maxFileSize) continue;

            const relativePath = relative(folderPath, fullPath).replace(/\\/g, "/");
            files.push({
                relativePath,
                fullPath,
                modifiedAt: st.mtimeMs,
                size: st.size,
            });
        }
    }

    await walk(folderPath);
    return files;
}
