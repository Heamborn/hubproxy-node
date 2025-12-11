# HubProxy Node.js

轻量级多功能代理服务的 Node.js 版本，支持 Docker 镜像加速、GitHub 文件加速。

## ✨ 功能特性

- 🐳 **Docker 镜像加速** - 支持 Docker Hub、GHCR、Quay.io、K8s 等多种镜像仓库
- 🚀 **GitHub 文件加速** - 支持 Release、Raw、Archive 等资源加速
- 🤗 **Hugging Face 加速** - 支持模型和数据集下载加速
- 🔍 **镜像搜索** - 在线搜索 Docker Hub 镜像
- 🛡️ **访问控制** - 支持仓库/镜像黑白名单
- ⚡ **IP 限流** - Token Bucket 算法，支持 IP 黑白名单

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
npm start
```

服务默认监听 `0.0.0.0:16633`

### 访问服务

- 主页：`http://localhost:16633`
- 镜像搜索：`http://localhost:16633/search.html`
- 健康检查：`http://localhost:16633/ready`

## 📖 使用方法

### Docker 镜像加速

```bash
# Docker Hub 官方镜像
docker pull your-domain.com/nginx

# Docker Hub 用户镜像
docker pull your-domain.com/user/image

# GHCR 镜像
docker pull your-domain.com/ghcr.io/user/image

# Quay.io 镜像
docker pull your-domain.com/quay.io/org/image

# Kubernetes 镜像
docker pull your-domain.com/registry.k8s.io/pause:3.8
```

### GitHub 文件加速

在 GitHub 链接前添加域名即可：

```
https://your-domain.com/https://github.com/user/repo/releases/download/v1.0/file.zip
https://your-domain.com/https://raw.githubusercontent.com/user/repo/main/README.md
```

## ⚙️ 配置

创建 `config.toml` 文件自定义配置（可选）：

```toml
[server]
host = "0.0.0.0"
port = 16633
fileSize = 2147483648  # 2GB

[rateLimit]
requestLimit = 500
periodHours = 3.0
whitelist = ["127.0.0.1", "192.168.0.0/16"]
blacklist = []

[accessControl]
mode = "blacklist"  # whitelist 或 blacklist
whitelist = []
blacklist = ["malicious/*"]
```

### 环境变量

也可以用环境变量覆盖配置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 16633 |
| `HOST` | 监听地址 | 0.0.0.0 |
| `RATE_LIMIT` | 请求限制数 | 500 |
| `RATE_PERIOD_HOURS` | 限流周期(小时) | 3 |

## 📁 项目结构

```
hubproxy-node/
├── app.js                 # 主入口
├── config.js              # 配置管理
├── package.json
├── routes/
│   ├── github.js          # GitHub 代理
│   ├── docker.js          # Docker Registry 代理
│   └── search.js          # 镜像搜索 API
├── middleware/
│   ├── ratelimiter.js     # IP 限流
│   └── accessControl.js   # 访问控制
├── utils/
│   ├── httpClient.js      # HTTP 客户端
│   └── cache.js           # 缓存管理
└── public/
    ├── index.html         # 主页
    ├── search.html        # 搜索页
    └── favicon.ico
```

## 🔧 API 接口

| 端点 | 说明 |
|------|------|
| `GET /ready` | 健康检查 |
| `GET /search?q=xxx` | 搜索 Docker 镜像 |
| `GET /tags/:namespace/:name` | 获取镜像标签 |
| `GET /v2/*` | Docker Registry API v2 |
| `GET /token` | Docker 认证代理 |
| `GET /*` | GitHub 文件代理 |

## 📝 许可证

MIT License

## 🙏 致谢

基于 [hubproxy](https://github.com/sky22333/hubproxy) Go 版本迁移
