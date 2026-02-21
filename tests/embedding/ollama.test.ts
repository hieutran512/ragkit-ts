import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createOllamaEmbed } from "../../src/embedding/ollama.js";

describe("createOllamaEmbed", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("uses batch endpoint when available", async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockImplementation(async () => ({
            ok: true,
            json: async () => ({ embeddings: [[1, 0], [0, 1]] }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;

        const embed = createOllamaEmbed({ baseUrl: "http://localhost:11434/", model: "m1" });
        const result = await embed(["a", "b"]);

        expect(result).toEqual([[1, 0], [0, 1]]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/embed");
    });

    it("falls back to per-input endpoint when batch is unavailable", async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockImplementationOnce(async () => ({
            ok: false,
            status: 404,
            statusText: "Not Found",
            json: async () => ({}),
        } as Response));
        fetchMock.mockImplementationOnce(async () => ({
            ok: true,
            json: async () => ({ embedding: [1, 2] }),
        } as Response));
        fetchMock.mockImplementationOnce(async () => ({
            ok: true,
            json: async () => ({ embedding: [3, 4] }),
        } as Response));

        global.fetch = fetchMock as unknown as typeof fetch;

        const embed = createOllamaEmbed();
        const result = await embed(["x", "y"]);

        expect(result).toEqual([[1, 2], [3, 4]]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(String(fetchMock.mock.calls[1][0])).toContain("/api/embeddings");
    });

    it("throws when fallback embedding request fails", async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockImplementationOnce(async () => ({
            ok: false,
            status: 500,
            statusText: "Server Error",
            json: async () => ({}),
        } as Response));
        fetchMock.mockImplementationOnce(async () => ({
            ok: false,
            status: 500,
            statusText: "Server Error",
            json: async () => ({}),
        } as Response));

        global.fetch = fetchMock as unknown as typeof fetch;

        const embed = createOllamaEmbed();
        await expect(embed(["q"]))
            .rejects
            .toThrow("Embedding failed: 500 Server Error");
    });

    it("returns empty list for empty input", async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        global.fetch = fetchMock as unknown as typeof fetch;

        const embed = createOllamaEmbed();
        await expect(embed([])).resolves.toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
