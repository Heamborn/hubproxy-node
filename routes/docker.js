/**
 * Docker Registry 代理路由
 * 对应原 Go 项目的 handlers/docker.go
 */

const fetch = require('node-fetch');
const { getConfig } = require('../config');
const { checkDockerAccess } = require('../middleware/accessControl');
const { tokenCache } = require('../utils/cache');

// Docker Hub 默认配置
const DOCKER_HUB_REGISTRY = 'registry-1.docker.io';
const DOCKER_HUB_AUTH = 'auth.docker.io';

/**
 * 检测 Registry 域名
 */
function detectRegistryDomain(path) {
    const config = getConfig();
    const registries = config.registries || {};

    // 检查路径中是否包含已知的 registry 域名
    for (const domain of Object.keys(registries)) {
        if (path.startsWith(domain + '/') || path.startsWith('/' + domain + '/')) {
            const remaining = path.replace(new RegExp(`^/?${domain}/`), '');
            return { domain, remaining };
        }
    }

    return { domain: null, remaining: path };
}

/**
 * 获取 Registry 映射配置
 */
function getRegistryMapping(domain) {
    const config = getConfig();
    return config.registries?.[domain] || null;
}

/**
 * 解析 Registry 路径
 * 返回: { imageName, apiType, reference }
 */
function parseRegistryPath(path) {
    // 移除开头的 /v2/
    let cleanPath = path.replace(/^\/v2\/?/, '');

    // 检测是否包含其他 registry 域名
    const { domain, remaining } = detectRegistryDomain(cleanPath);
    if (domain) {
        cleanPath = remaining;
    }

    // 解析 API 类型和引用
    const manifestsMatch = cleanPath.match(/^(.+?)\/manifests\/(.+)$/);
    if (manifestsMatch) {
        return { imageName: manifestsMatch[1], apiType: 'manifests', reference: manifestsMatch[2], registryDomain: domain };
    }

    const blobsMatch = cleanPath.match(/^(.+?)\/blobs\/(.+)$/);
    if (blobsMatch) {
        return { imageName: blobsMatch[1], apiType: 'blobs', reference: blobsMatch[2], registryDomain: domain };
    }

    const tagsMatch = cleanPath.match(/^(.+?)\/tags\/list$/);
    if (tagsMatch) {
        return { imageName: tagsMatch[1], apiType: 'tags', reference: '', registryDomain: domain };
    }

    return { imageName: cleanPath, apiType: '', reference: '', registryDomain: domain };
}

/**
 * 获取 Docker Auth Token
 */
async function getAuthToken(scope, registryDomain = null) {
    const cacheKey = `token:${registryDomain || 'docker'}:${scope}`;
    const cached = tokenCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    let authUrl;
    if (registryDomain) {
        const mapping = getRegistryMapping(registryDomain);
        if (mapping) {
            // 根据 authType 构建认证 URL
            switch (mapping.authType) {
                case 'github':
                    authUrl = `https://ghcr.io/token?scope=${encodeURIComponent(scope)}`;
                    break;
                case 'google':
                    authUrl = `https://gcr.io/v2/token?scope=${encodeURIComponent(scope)}`;
                    break;
                case 'quay':
                    authUrl = `https://quay.io/v2/auth?scope=${encodeURIComponent(scope)}`;
                    break;
                case 'anonymous':
                    return null; // 匿名访问
                default:
                    authUrl = `https://${mapping.authHost}?scope=${encodeURIComponent(scope)}`;
            }
        }
    }

    if (!authUrl) {
        // Docker Hub 认证
        authUrl = `https://${DOCKER_HUB_AUTH}/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`;
    }

    try {
        const response = await fetch(authUrl);
        if (response.ok) {
            const data = await response.json();
            const token = data.token || data.access_token;
            if (token) {
                tokenCache.set(cacheKey, token, 15 * 60 * 1000); // 缓存 15 分钟
                return token;
            }
        }
    } catch (error) {
        console.error(`获取 Auth Token 失败: ${error.message}`);
    }

    return null;
}

/**
 * 构建上游 Registry URL
 */
function buildUpstreamURL(registryDomain, imageName, apiType, reference) {
    let upstream = DOCKER_HUB_REGISTRY;

    if (registryDomain) {
        const mapping = getRegistryMapping(registryDomain);
        if (mapping) {
            upstream = mapping.upstream;
        }
    }

    // 对于 Docker Hub，没有命名空间的镜像需要添加 library/
    if (!registryDomain && !imageName.includes('/')) {
        imageName = `library/${imageName}`;
    }

    let url = `https://${upstream}/v2/${imageName}`;

    if (apiType === 'manifests') {
        url += `/manifests/${reference}`;
    } else if (apiType === 'blobs') {
        url += `/blobs/${reference}`;
    } else if (apiType === 'tags') {
        url += '/tags/list';
    }

    return url;
}

/**
 * Docker Registry v2 API 代理
 */
async function proxyDockerRegistry(req, res) {
    const path = req.path;

    // /v2/ 根路径检查
    if (path === '/v2/' || path === '/v2') {
        return res.json({});
    }

    const { imageName, apiType, reference, registryDomain } = parseRegistryPath(path);

    if (!imageName) {
        return res.status(400).json({ error: 'Invalid request path' });
    }

    // 检查访问权限
    const fullImageName = registryDomain ? `${registryDomain}/${imageName}` : imageName;
    const { allowed, reason } = checkDockerAccess(fullImageName);
    if (!allowed) {
        console.log(`Docker 镜像 ${fullImageName} 访问被拒绝: ${reason}`);
        return res.status(403).json({ error: reason });
    }

    // 构建上游 URL
    const upstreamURL = buildUpstreamURL(registryDomain, imageName, apiType, reference);

    try {
        // 获取认证 Token
        const scope = `repository:${registryDomain ? imageName : (imageName.includes('/') ? imageName : `library/${imageName}`)}:pull`;
        const token = await getAuthToken(scope, registryDomain);

        // 构建请求头
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // 复制客户端的 Accept 头
        if (req.headers.accept) {
            headers['Accept'] = req.headers.accept;
        } else if (apiType === 'manifests') {
            headers['Accept'] = [
                'application/vnd.docker.distribution.manifest.v2+json',
                'application/vnd.docker.distribution.manifest.list.v2+json',
                'application/vnd.oci.image.manifest.v1+json',
                'application/vnd.oci.image.index.v1+json',
            ].join(', ');
        }

        const response = await fetch(upstreamURL, {
            method: req.method,
            headers,
            redirect: 'follow',
        });

        // 复制响应头
        const responseHeaders = {};
        for (const [key, value] of response.headers.entries()) {
            if (!['transfer-encoding', 'connection', 'www-authenticate'].includes(key.toLowerCase())) {
                responseHeaders[key] = value;
            }
        }

        // 重写 www-authenticate 头
        const wwwAuth = response.headers.get('www-authenticate');
        if (wwwAuth) {
            const proxyHost = req.headers['x-forwarded-host'] || req.headers.host || '';
            const scheme = req.headers['x-forwarded-proto'] || 'https';
            const rewritten = wwwAuth.replace(
                /realm="[^"]+"/,
                `realm="${scheme}://${proxyHost}/token"`
            );
            responseHeaders['www-authenticate'] = rewritten;
        }

        res.set(responseHeaders);
        res.status(response.status);

        if (response.body) {
            response.body.pipe(res);
        } else {
            res.end();
        }
    } catch (error) {
        console.error(`Docker Registry 代理错误: ${error.message}`);
        res.status(500).json({ error: `服务器错误: ${error.message}` });
    }
}

/**
 * Docker Auth Token 代理
 */
async function proxyDockerAuth(req, res) {
    const query = req.query;
    const scope = query.scope || '';
    const service = query.service || 'registry.docker.io';

    // 构建上游认证 URL
    const authUrl = new URL(`https://${DOCKER_HUB_AUTH}/token`);
    authUrl.searchParams.set('service', service);
    if (scope) {
        authUrl.searchParams.set('scope', scope);
    }

    try {
        const response = await fetch(authUrl.toString());
        const data = await response.text();

        // 复制响应头
        for (const [key, value] of response.headers.entries()) {
            if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
                res.set(key, value);
            }
        }

        res.status(response.status);
        res.send(data);
    } catch (error) {
        console.error(`Docker Auth 代理错误: ${error.message}`);
        res.status(500).json({ error: `服务器错误: ${error.message}` });
    }
}

/**
 * 注册 Docker Registry 路由
 */
function registerDockerRoutes(app) {
    // Token 认证路由
    app.all('/token', proxyDockerAuth);
    app.all('/token/*', proxyDockerAuth);

    // Registry v2 API 路由
    app.all('/v2', proxyDockerRegistry);
    app.all('/v2/*', proxyDockerRegistry);
}

module.exports = {
    registerDockerRoutes,
    proxyDockerRegistry,
    proxyDockerAuth,
    parseRegistryPath,
    getAuthToken,
};
