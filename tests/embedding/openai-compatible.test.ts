import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleEmbed } from "../../src/embedding/openai-compatible.js";

describe("createOpenAICompatibleEmbed", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("calls /v1/embeddings and returns vectors in index order", async () => {
        const fetchMock = vi.fn<typeof fetch>();
        fetchMock.mockImplementation(async () => ({
            ok: true,
            json: async () => ({
                data: [
                    { index: 1, embedding: [0, 1] },
                    { index: 0, embedding: [1, 0] },
                ],
            }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;

        const embed = createOpenAICompatibleEmbed({
            baseUrl: "http://localhost:1234/",
            model: "m1",
        });

        const result = await embed(["a", "b"]);

        expect(result).toEqual([[1, 0], [0, 1]]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:1234/v1/embeddings");
    });

    it("supports auth and custom headers", async () => {
        const fetchMock = vi.fn<typeof fetch>();
        fetchMock.mockImplementation(async () => ({
            ok: true,
            json: async () => ({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
        } as Response));
        global.fetch = fetchMock as unknown as typeof fetch;

        const embed = createOpenAICompatibleEmbed({
            apiKey: "test-key",
            headers: { "X-Test": "1" },
        });

        await embed(["x"]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer test-key",
                "X-Test": "1",
            },
        });
    });

    it("throws with API response details on non-2xx", async () => {
        const fetchMock = vi.fn<typeof fetch>();
        fetchMock.mockImplementation(async () => ({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
            text: async () => "bad key",
        } as unknown as Response));
        global.fetch = fetchMock as unknown as typeof fetch;

        const embed = createOpenAICompatibleEmbed();
        await expect(embed(["q"]))
            .rejects
            .toThrow("Embedding failed: 401 Unauthorized - bad key");
    });

    it("returns empty list for empty input", async () => {
        const fetchMock = vi.fn<typeof fetch>();
        global.fetch = fetchMock as unknown as typeof fetch;

        const embed = createOpenAICompatibleEmbed();
        await expect(embed([])).resolves.toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
