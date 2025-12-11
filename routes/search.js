/**
 * Docker 镜像搜索路由
 * 对应原 Go 项目的 handlers/search.go
 */

const fetch = require('node-fetch');
const { searchCache } = require('../utils/cache');

// Docker Hub API 基础 URL
const DOCKER_HUB_API = 'https://hub.docker.com/v2';

/**
 * 搜索 Docker Hub 镜像
 */
async function searchDockerHub(query, page = 1, pageSize = 25) {
    const cacheKey = `search:${query}:${page}:${pageSize}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const url = `${DOCKER_HUB_API}/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`;

    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Docker Hub API 返回 ${response.status}`);
        }

        const data = await response.json();

        // 规范化结果
        const results = {
            count: data.count || 0,
            next: data.next || null,
            previous: data.previous || null,
            results: (data.results || []).map(repo => ({
                repo_name: repo.repo_name || repo.name,
                short_description: repo.short_description || '',
                is_official: repo.is_official || false,
                is_automated: repo.is_automated || false,
                star_count: repo.star_count || 0,
                pull_count: repo.pull_count || 0,
                last_updated: repo.last_updated || '',
                namespace: repo.namespace || 'library',
            })),
        };

        searchCache.set(cacheKey, results);
        return results;
    } catch (error) {
        console.error(`搜索 Docker Hub 失败: ${error.message}`);
        throw error;
    }
}

/**
 * 获取仓库标签列表
 */
async function getRepositoryTags(namespace, name, page = 1, pageSize = 25) {
    const cacheKey = `tags:${namespace}/${name}:${page}:${pageSize}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // 对于官方镜像，命名空间是 library
    const ns = namespace || 'library';
    const url = `${DOCKER_HUB_API}/namespaces/${ns}/repositories/${name}/tags?page=${page}&page_size=${pageSize}`;

    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Docker Hub API 返回 ${response.status}`);
        }

        const data = await response.json();

        // 处理标签数据
        const tags = (data.results || []).map(tag => ({
            name: tag.name,
            full_size: tag.full_size || 0,
            last_updated: tag.last_updated || tag.tag_last_pushed || '',
            digest: tag.digest || '',
            images: (tag.images || []).map(img => ({
                architecture: img.architecture || '',
                os: img.os || '',
                size: img.size || 0,
                digest: img.digest || '',
            })),
        }));

        const result = {
            tags,
            has_more: !!data.next,
            count: data.count || tags.length,
        };

        searchCache.set(cacheKey, result);
        return result;
    } catch (error) {
        console.error(`获取标签列表失败: ${error.message}`);
        throw error;
    }
}

/**
 * 搜索处理器
 */
async function searchHandler(req, res) {
    const { q, query, page = '1', page_size = '25' } = req.query;
    const searchQuery = q || query;

    if (!searchQuery) {
        return res.status(400).json({ error: '请提供搜索关键词 (q 或 query 参数)' });
    }

    try {
        const results = await searchDockerHub(
            searchQuery,
            parseInt(page, 10),
            parseInt(page_size, 10)
        );
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * 标签列表处理器
 */
async function tagsHandler(req, res) {
    const { namespace, name, page = '1', page_size = '25' } = req.query;

    if (!name) {
        return res.status(400).json({ error: '请提供镜像名称 (name 参数)' });
    }

    try {
        const results = await getRepositoryTags(
            namespace,
            name,
            parseInt(page, 10),
            parseInt(page_size, 10)
        );
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * 注册搜索路由
 */
function registerSearchRoutes(app) {
    app.get('/api/search', searchHandler);
    app.get('/api/tags', tagsHandler);
}

module.exports = {
    registerSearchRoutes,
    searchDockerHub,
    getRepositoryTags,
};
