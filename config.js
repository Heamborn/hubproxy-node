/**
 * HubProxy 配置管理模块
 * 对应原 Go 项目的 config/config.go
 */

const fs = require('fs');
const path = require('path');

// 默认配置
const defaultConfig = {
    server: {
        host: '0.0.0.0',
        port: 16633,
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB
    },
    rateLimit: {
        requestLimit: 500,
        periodHours: 3.0,
    },
    security: {
        whiteList: [],
        blackList: [],
    },
    access: {
        whiteList: [],
        blackList: [],
        proxy: '',
    },
    registries: {
        'ghcr.io': {
            upstream: 'ghcr.io',
            authHost: 'ghcr.io/token',
            authType: 'github',
            enabled: true,
        },
        'gcr.io': {
            upstream: 'gcr.io',
            authHost: 'gcr.io/v2/token',
            authType: 'google',
            enabled: true,
        },
        'quay.io': {
            upstream: 'quay.io',
            authHost: 'quay.io/v2/auth',
            authType: 'quay',
            enabled: true,
        },
        'registry.k8s.io': {
            upstream: 'registry.k8s.io',
            authHost: 'registry.k8s.io',
            authType: 'anonymous',
            enabled: true,
        },
    },
    tokenCache: {
        enabled: true,
        defaultTTL: '20m',
    },
};

let appConfig = null;

/**
 * 加载配置
 */
function loadConfig() {
    // 复制默认配置
    appConfig = JSON.parse(JSON.stringify(defaultConfig));

    // 尝试加载 TOML 配置文件
    const configPath = path.join(process.cwd(), 'config.toml');
    if (fs.existsSync(configPath)) {
        try {
            const toml = require('@iarna/toml');
            const fileConfig = toml.parse(fs.readFileSync(configPath, 'utf-8'));
            appConfig = mergeConfig(appConfig, fileConfig);
            console.log('已加载配置文件: config.toml');
        } catch (err) {
            console.error(`解析配置文件失败: ${err.message}`);
        }
    } else {
        console.log('未找到 config.toml，使用默认配置');
    }

    // 从环境变量覆盖
    overrideFromEnv();

    return appConfig;
}

/**
 * 合并配置
 */
function mergeConfig(base, override) {
    const result = { ...base };
    for (const key in override) {
        if (typeof override[key] === 'object' && !Array.isArray(override[key]) && override[key] !== null) {
            result[key] = mergeConfig(base[key] || {}, override[key]);
        } else {
            result[key] = override[key];
        }
    }
    return result;
}

/**
 * 从环境变量覆盖配置
 */
function overrideFromEnv() {
    if (process.env.SERVER_HOST) {
        appConfig.server.host = process.env.SERVER_HOST;
    }
    if (process.env.SERVER_PORT) {
        const port = parseInt(process.env.SERVER_PORT, 10);
        if (port > 0) appConfig.server.port = port;
    }
    if (process.env.MAX_FILE_SIZE) {
        const size = parseInt(process.env.MAX_FILE_SIZE, 10);
        if (size > 0) appConfig.server.fileSize = size;
    }
    if (process.env.RATE_LIMIT) {
        const limit = parseInt(process.env.RATE_LIMIT, 10);
        if (limit > 0) appConfig.rateLimit.requestLimit = limit;
    }
    if (process.env.RATE_PERIOD_HOURS) {
        const period = parseFloat(process.env.RATE_PERIOD_HOURS);
        if (period > 0) appConfig.rateLimit.periodHours = period;
    }
    if (process.env.IP_WHITELIST) {
        appConfig.security.whiteList = [
            ...appConfig.security.whiteList,
            ...process.env.IP_WHITELIST.split(',').map(s => s.trim()),
        ];
    }
    if (process.env.IP_BLACKLIST) {
        appConfig.security.blackList = [
            ...appConfig.security.blackList,
            ...process.env.IP_BLACKLIST.split(',').map(s => s.trim()),
        ];
    }
}

/**
 * 获取配置
 */
function getConfig() {
    if (!appConfig) {
        loadConfig();
    }
    return appConfig;
}

module.exports = {
    loadConfig,
    getConfig,
    defaultConfig,
};
