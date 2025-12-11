/**
 * HubProxy Node.js 版本主入口
 * 对应原 Go 项目的 main.go
 */

const express = require('express');
const path = require('path');
const { loadConfig, getConfig } = require('./config');
const { createRateLimiter } = require('./middleware/ratelimiter');
const { registerDockerRoutes } = require('./routes/docker');
const { registerSearchRoutes } = require('./routes/search');
const { githubProxyHandler } = require('./routes/github');

// 服务启动时间
const serviceStartTime = Date.now();

// 初始化配置
loadConfig();
const config = getConfig();

// 创建 Express 应用
const app = express();

// 信任代理（获取真实IP）
app.set('trust proxy', true);

// 限流中间件
app.use(createRateLimiter());

// 静态文件路由
app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// 主页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 镜像搜索页
app.get('/search.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'search.html'));
});

// 健康检查路由
app.get('/ready', (req, res) => {
    const uptimeMs = Date.now() - serviceStartTime;
    const uptimeSec = Math.floor(uptimeMs / 1000);

    let uptimeHuman;
    if (uptimeSec < 60) {
        uptimeHuman = `${uptimeSec}秒`;
    } else if (uptimeSec < 3600) {
        uptimeHuman = `${Math.floor(uptimeSec / 60)}分钟${uptimeSec % 60}秒`;
    } else if (uptimeSec < 86400) {
        uptimeHuman = `${Math.floor(uptimeSec / 3600)}小时${Math.floor((uptimeSec % 3600) / 60)}分钟`;
    } else {
        const days = Math.floor(uptimeSec / 86400);
        const hours = Math.floor((uptimeSec % 86400) / 3600);
        uptimeHuman = `${days}天${hours}小时`;
    }

    res.json({
        ready: true,
        service: 'hubproxy-node',
        start_time_unix: Math.floor(serviceStartTime / 1000),
        uptime_sec: uptimeSec,
        uptime_human: uptimeHuman,
    });
});

// 注册 Docker Registry 路由
registerDockerRoutes(app);

// 注册搜索 API 路由
registerSearchRoutes(app);

// 兼容原项目的搜索路由路径
const { searchDockerHub, getRepositoryTags } = require('./routes/search');
app.get('/search', async (req, res) => {
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
});

app.get('/tags', async (req, res) => {
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
});

// 路径参数格式的 tags 路由：/tags/:namespace/:name 或 /tags/:namespace/:name/*
app.get('/tags/:namespace/*', async (req, res) => {
    let namespace = req.params.namespace;
    let name = req.params[0]; // 获取通配符匹配的部分
    const { page = '1', page_size = '100' } = req.query;

    // 如果 name 包含斜杠，说明前端传错了，需要重新解析
    // 例如：/tags/library/rancher/nginx 应该解析为 namespace=rancher, name=nginx
    if (name && name.includes('/')) {
        const parts = name.split('/');
        if (namespace === 'library' && parts.length >= 2) {
            // 前端错误地把 namespace 设为 library
            namespace = parts[0];
            name = parts.slice(1).join('/');
        }
    }

    // 对于 URL 编码的斜杠 (如 rancher%2Fnginx)，decodeURIComponent 会解码
    if (name && name.includes('/')) {
        const parts = name.split('/');
        namespace = parts[0];
        name = parts.slice(1).join('/');
    }

    console.log(`Tags API: namespace=${namespace}, name=${name}`);

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
});

// GitHub 代理路由（NoRoute 处理器 - 最后）
app.use(githubProxyHandler);

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
    });
});

// 启动服务器
const PORT = config.server.port || 5000;
const HOST = config.server.host || '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log('HubProxy Node.js 版本启动成功');
    console.log(`监听地址: ${HOST}:${PORT}`);
    console.log(`限流配置: ${config.rateLimit.requestLimit}请求/${config.rateLimit.periodHours}小时`);
    console.log('版本号: v1.0.0-node');
    console.log('项目地址: https://github.com/sky22333/hubproxy');
});

module.exports = app;
