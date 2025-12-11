/**
 * GitHub 代理路由
 * 对应原 Go 项目的 handlers/github.go
 */

const fetch = require('node-fetch');
const { getConfig } = require('../config');
const { checkGitHubAccess } = require('../middleware/accessControl');

// GitHub URL 匹配正则表达式
const githubPatterns = [
    /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/(?:releases|archive)\/.*/,
    /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/.*/,
    /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/(?:info|git-).*/,
    /^(?:https?:\/\/)?raw\.github(?:usercontent)?\.com\/([^/]+)\/([^/]+)\/.+?\/.+/,
    /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/([^/]+)\/([^/]+).*/,
    /^(?:https?:\/\/)?api\.github\.com\/repos\/([^/]+)\/([^/]+)\/.*/,
    /^(?:https?:\/\/)?huggingface\.co(?:\/spaces)?\/([^/]+)\/(.+)/,
    /^(?:https?:\/\/)?cdn-lfs\.hf\.co(?:\/spaces)?\/([^/]+)\/([^/]+)(?:\/(.*))?/,
    /^(?:https?:\/\/)?download\.docker\.com\/([^/]+)\/.*\.(tgz|zip)/,
    /^(?:https?:\/\/)?(github|opengraph)\.githubassets\.com\/([^/]+)\/.+?/,
];

// 阻止的内容类型
const blockedContentTypes = new Set([
    'text/html',
    'application/xhtml+xml',
    'text/xml',
    'application/xml',
]);

/**
 * 检查 URL 是否匹配 GitHub 模式
 */
function checkGitHubURL(url) {
    for (const pattern of githubPatterns) {
        const matches = url.match(pattern);
        if (matches) {
            return matches.slice(1);
        }
    }
    return null;
}

/**
 * GitHub 代理处理器
 */
async function githubProxyHandler(req, res) {
    let rawPath = req.originalUrl.slice(1); // 移除开头的 /

    // 移除多余的斜杠
    while (rawPath.startsWith('/')) {
        rawPath = rawPath.slice(1);
    }

    // 自动补全协议头
    if (!rawPath.startsWith('https://')) {
        rawPath = rawPath.replace(/^https?:\//, '');
        rawPath = rawPath.replace(/^http:\/\//, '');
        rawPath = 'https://' + rawPath;
    }

    const matches = checkGitHubURL(rawPath);
    if (!matches) {
        return res.status(403).send('无效输入');
    }

    // 检查访问权限
    if (matches.length >= 2) {
        const { allowed, reason } = checkGitHubAccess(matches[0], matches[1]);
        if (!allowed) {
            const repoPath = `${matches[0]}/${matches[1].replace(/\.git$/, '')}`;
            console.log(`GitHub仓库 ${repoPath} 访问被拒绝: ${reason}`);
            return res.status(403).send(reason);
        }
    }

    // 将 blob 链接转换为 raw 链接
    if (githubPatterns[1].test(rawPath)) {
        rawPath = rawPath.replace('/blob/', '/raw/');
    }

    await proxyGitHubRequest(req, res, rawPath);
}

/**
 * 代理 GitHub 请求
 */
async function proxyGitHubRequest(req, res, url, redirectCount = 0) {
    const MAX_REDIRECTS = 20;

    if (redirectCount > MAX_REDIRECTS) {
        return res.status(508).send('重定向次数过多，可能存在循环重定向');
    }

    try {
        // 复制请求头
        const headers = { ...req.headers };
        delete headers.host;
        delete headers.connection;

        const response = await fetch(url, {
            method: req.method,
            headers,
            body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
            redirect: 'manual', // 手动处理重定向
        });

        // 处理重定向（在检查内容类型之前处理重定向）
        const location = response.headers.get('location');
        if (location && response.status >= 300 && response.status < 400) {
            // 继续代理重定向目标
            return proxyGitHubRequest(req, res, location, redirectCount + 1);
        }

        // 检查内容类型（只在最终响应时检查，不在重定向响应时检查）
        if (req.method === 'GET' && response.status >= 200 && response.status < 300) {
            const contentType = response.headers.get('content-type') || '';
            const baseType = contentType.split(';')[0].toLowerCase();
            if (blockedContentTypes.has(baseType)) {
                return res.status(403).json({
                    error: 'Content type not allowed',
                    message: '检测到网页类型，本服务不支持加速网页，请检查您的链接是否正确。',
                });
            }
        }

        // 检查文件大小限制
        const config = getConfig();
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            const size = parseInt(contentLength, 10);
            if (size > config.server.fileSize) {
                return res.status(413).send(
                    `文件过大，限制大小: ${Math.floor(config.server.fileSize / (1024 * 1024))} MB`
                );
            }
        }

        // 获取真实域名用于处理脚本
        let realHost = req.headers['x-forwarded-host'] || req.headers.host || '';
        if (!realHost.startsWith('http://') && !realHost.startsWith('https://')) {
            realHost = 'https://' + realHost;
        }

        // 复制响应头
        const responseHeaders = {};
        for (const [key, value] of response.headers.entries()) {
            // 跳过一些头
            if (['content-security-policy', 'referrer-policy', 'strict-transport-security',
                'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
                continue;
            }
            responseHeaders[key] = value;
        }

        // 处理 .sh 和 .ps1 文件的智能替换
        const lowercaseUrl = url.toLowerCase();
        if (lowercaseUrl.endsWith('.sh') || lowercaseUrl.endsWith('.ps1')) {
            // 读取并替换脚本内容中的 GitHub URL
            let body = await response.text();

            // 替换常见的 GitHub 下载链接
            const githubUrlPatterns = [
                /https?:\/\/github\.com\/[^\s"']+/g,
                /https?:\/\/raw\.githubusercontent\.com\/[^\s"']+/g,
            ];

            for (const pattern of githubUrlPatterns) {
                body = body.replace(pattern, match => `${realHost}/${match}`);
            }

            delete responseHeaders['content-length'];
            res.set(responseHeaders);
            res.status(response.status);
            return res.send(body);
        }

        // 流式响应
        res.set(responseHeaders);
        res.status(response.status);
        response.body.pipe(res);
    } catch (error) {
        console.error(`GitHub 代理错误: ${error.message}`);
        res.status(500).send(`服务器错误: ${error.message}`);
    }
}

/**
 * 注册 GitHub 代理路由
 */
function registerGitHubRoutes(app) {
    // NoRoute 处理器 - 作为最后的路由处理
    // 在 app.js 中以中间件方式使用
}

module.exports = {
    githubProxyHandler,
    checkGitHubURL,
    proxyGitHubRequest,
    registerGitHubRoutes,
};
