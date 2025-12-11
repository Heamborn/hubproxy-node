/**
 * IP 限流中间件
 * 对应原 Go 项目的 utils/ratelimiter.go
 */

const { getConfig } = require('../config');

// 限流存储
const ipRecords = new Map();

// 常量
const CLEANUP_INTERVAL = 20 * 60 * 1000; // 20 分钟
const MAX_IP_CACHE_SIZE = 10000;

/**
 * 解析 CIDR
 */
function parseCIDR(cidr) {
    let ip, prefix;
    if (cidr.includes('/')) {
        [ip, prefix] = cidr.split('/');
        prefix = parseInt(prefix, 10);
    } else {
        ip = cidr;
        prefix = ip.includes(':') ? 128 : 32;
    }

    const isIPv6 = ip.includes(':');
    const bytes = isIPv6 ? parseIPv6(ip) : parseIPv4(ip);

    return { bytes, prefix, isIPv6 };
}

/**
 * 解析 IPv4
 */
function parseIPv4(ip) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    return new Uint8Array(parts);
}

/**
 * 解析 IPv6
 */
function parseIPv6(ip) {
    const bytes = new Uint8Array(16);
    // 处理 :: 缩写
    let parts = ip.split(':');
    const emptyIdx = parts.indexOf('');

    if (emptyIdx !== -1) {
        const before = parts.slice(0, emptyIdx).filter(p => p);
        const after = parts.slice(emptyIdx + 1).filter(p => p);
        const missing = 8 - before.length - after.length;
        parts = [...before, ...Array(missing).fill('0'), ...after];
    }

    for (let i = 0; i < 8; i++) {
        const val = parseInt(parts[i] || '0', 16);
        bytes[i * 2] = (val >> 8) & 0xff;
        bytes[i * 2 + 1] = val & 0xff;
    }

    return bytes;
}

/**
 * 检查 IP 是否在 CIDR 范围内
 */
function isIPInCIDR(ip, cidr) {
    try {
        const isIPv6 = ip.includes(':');
        const ipBytes = isIPv6 ? parseIPv6(ip) : parseIPv4(ip);
        const cidrParsed = parseCIDR(cidr);

        if (isIPv6 !== cidrParsed.isIPv6) {
            return false;
        }

        const fullBytes = cidrParsed.bytes.length;
        const prefix = cidrParsed.prefix;

        for (let i = 0; i < fullBytes; i++) {
            const bitsInThisByte = Math.min(8, Math.max(0, prefix - i * 8));
            if (bitsInThisByte === 0) break;

            const mask = (0xff << (8 - bitsInThisByte)) & 0xff;
            if ((ipBytes[i] & mask) !== (cidrParsed.bytes[i] & mask)) {
                return false;
            }
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * 检查 IP 是否在列表中
 */
function isIPInList(ip, list) {
    for (const item of list) {
        const cidr = item.includes('/') ? item : (ip.includes(':') ? `${item}/128` : `${item}/32`);
        if (isIPInCIDR(ip, cidr)) {
            return true;
        }
    }
    return false;
}

/**
 * 从请求中提取 IP
 */
function extractIP(req) {
    // 优先从代理头获取
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ips = forwarded.split(',');
        return ips[0].trim();
    }

    const realIP = req.headers['x-real-ip'];
    if (realIP) {
        return realIP.trim();
    }

    // 从 socket 获取
    let ip = req.socket?.remoteAddress || req.ip || '';
    // 移除 IPv6 前缀
    if (ip.startsWith('::ffff:')) {
        ip = ip.slice(7);
    }
    return ip;
}

/**
 * 标准化 IP（IPv6 /64 归一化）
 */
function normalizeIP(ip) {
    if (!ip.includes(':')) {
        return ip; // IPv4 直接返回
    }

    // IPv6: 对 /64 网段归一化
    const bytes = parseIPv6(ip);
    // 清零后 64 位
    for (let i = 8; i < 16; i++) {
        bytes[i] = 0;
    }

    // 转换回字符串
    const parts = [];
    for (let i = 0; i < 16; i += 2) {
        parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    }
    return parts.join(':') + '/64';
}

/**
 * 创建限流中间件
 */
function createRateLimiter() {
    const config = getConfig();
    const { requestLimit, periodHours } = config.rateLimit;
    const { whiteList, blackList } = config.security;

    // 计算每请求间隔（毫秒）
    const periodMs = periodHours * 3600 * 1000;

    // 定期清理过期记录
    setInterval(() => {
        const now = Date.now();
        for (const [ip, record] of ipRecords.entries()) {
            if (now - record.lastAccess > 2 * 3600 * 1000) {
                ipRecords.delete(ip);
            }
        }
        // 如果超过最大容量，清空
        if (ipRecords.size > MAX_IP_CACHE_SIZE) {
            ipRecords.clear();
        }
    }, CLEANUP_INTERVAL);

    return (req, res, next) => {
        const path = req.path;

        // 静态资源不限流
        if (path === '/' || path === '/favicon.ico' || path === '/images.html' ||
            path === '/search.html' || path.startsWith('/public/')) {
            return next();
        }

        const ip = extractIP(req);
        const cleanIP = ip.replace(/^\[|\]$/g, '');

        // 检查黑名单
        if (isIPInList(cleanIP, blackList)) {
            console.log(`IP ${cleanIP} 在黑名单中，拒绝访问`);
            return res.status(403).json({ error: '您已被限制访问' });
        }

        // 检查白名单
        if (isIPInList(cleanIP, whiteList)) {
            return next();
        }

        const normalizedIP = normalizeIP(cleanIP);
        const now = Date.now();

        let record = ipRecords.get(normalizedIP);
        if (!record) {
            record = {
                tokens: requestLimit,
                lastRefill: now,
                lastAccess: now,
            };
            ipRecords.set(normalizedIP, record);
        }

        // Token bucket 算法
        const elapsed = now - record.lastRefill;
        const refillAmount = (elapsed / periodMs) * requestLimit;
        record.tokens = Math.min(requestLimit, record.tokens + refillAmount);
        record.lastRefill = now;
        record.lastAccess = now;

        if (record.tokens < 1) {
            console.log(`IP ${cleanIP} 请求频率过快`);
            return res.status(429).json({ error: '请求频率过快，暂时限制访问' });
        }

        record.tokens -= 1;
        next();
    };
}

module.exports = {
    createRateLimiter,
    extractIP,
    isIPInList,
};
