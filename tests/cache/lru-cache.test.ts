import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { LruCache } from "../../src/cache/lru-cache.js";

describe("LruCache", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("stores and reads values", () => {
        const cache = new LruCache<number>(3);
        cache.set("a", 1);

        expect(cache.get("a")).toBe(1);
        expect(cache.has("a")).toBe(true);
        expect(cache.size).toBe(1);
    });

    it("expires values when TTL is exceeded", () => {
        let now = 1000;
        jest.spyOn(Date, "now").mockImplementation(() => now);

        const cache = new LruCache<string>(5, 100);
        cache.set("k", "v");

        now = 1099;
        expect(cache.get("k")).toBe("v");

        now = 1101;
        expect(cache.get("k")).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it("evicts the oldest entries when max size is exceeded", () => {
        let now = 1;
        jest.spyOn(Date, "now").mockImplementation(() => now++);

        const cache = new LruCache<number>(2);
        cache.set("first", 1);
        cache.set("second", 2);
        cache.set("third", 3);

        expect(cache.get("first")).toBeUndefined();
        expect(cache.get("second")).toBe(2);
        expect(cache.get("third")).toBe(3);
        expect(cache.size).toBe(2);
    });

    it("supports delete and clear", () => {
        const cache = new LruCache<number>(2);
        cache.set("a", 1);
        cache.set("b", 2);

        expect(cache.delete("a")).toBe(true);
        expect(cache.get("a")).toBeUndefined();

        cache.clear();
        expect(cache.size).toBe(0);
    });
});
