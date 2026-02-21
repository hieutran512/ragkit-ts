/**
 * A simple LRU cache with optional TTL-based expiration.
 */
export class LruCache<T> {
    private cache = new Map<string, { value: T; createdAt: number }>();
    private maxEntries: number;
    private ttlMs: number;

    /**
     * @param maxEntries Maximum number of entries before eviction.
     * @param ttlMs Time-to-live in milliseconds. Entries older than this are stale. 0 = no expiry.
     */
    constructor(maxEntries: number, ttlMs: number = 0) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (this.ttlMs > 0 && Date.now() - entry.createdAt > this.ttlMs) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.value;
    }

    set(key: string, value: T): void {
        this.cache.set(key, { value, createdAt: Date.now() });
        this.evict();
    }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }

    private evict(): void {
        if (this.cache.size <= this.maxEntries) return;

        const entries = Array.from(this.cache.entries()).sort(
            (a, b) => a[1].createdAt - b[1].createdAt,
        );

        const toRemove = this.cache.size - this.maxEntries;
        for (let i = 0; i < toRemove; i++) {
            this.cache.delete(entries[i][0]);
        }
    }
}
