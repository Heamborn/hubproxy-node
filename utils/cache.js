/**
 * 缓存管理模块
 * 对应原 Go 项目的 utils/cache.go
 */

class Cache {
    constructor(maxSize = 1000, defaultTTL = 30 * 60 * 1000) {
        this.data = new Map();
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
    }

    /**
     * 获取缓存
     */
    get(key) {
        const entry = this.data.get(key);
        if (!entry) {
            return null;
        }
        if (Date.now() > entry.expiresAt) {
            this.data.delete(key);
            return null;
        }
        return entry.value;
    }

    /**
     * 设置缓存
     */
    set(key, value, ttl = this.defaultTTL) {
        // 如果超过最大容量，清理过期条目
        if (this.data.size >= this.maxSize) {
            this.cleanup();
        }
        // 如果还是超过容量，删除最早的条目
        if (this.data.size >= this.maxSize) {
            const firstKey = this.data.keys().next().value;
            this.data.delete(firstKey);
        }

        this.data.set(key, {
            value,
            expiresAt: Date.now() + ttl,
        });
    }

    /**
     * 清理过期条目
     */
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.data.entries()) {
            if (now > entry.expiresAt) {
                this.data.delete(key);
            }
        }
    }

    /**
     * 删除指定缓存
     */
    delete(key) {
        this.data.delete(key);
    }

    /**
     * 清空所有缓存
     */
    clear() {
        this.data.clear();
    }

    /**
     * 获取缓存数量
     */
    get size() {
        return this.data.size;
    }
}

// 全局缓存实例
const tokenCache = new Cache(500, 20 * 60 * 1000); // Token 缓存，20分钟TTL
const searchCache = new Cache(1000, 30 * 60 * 1000); // 搜索结果缓存，30分钟TTL

module.exports = {
    Cache,
    tokenCache,
    searchCache,
};
