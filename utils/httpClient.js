/**
 * HTTP 客户端封装
 * 对应原 Go 项目的 utils/http_client.go
 */

const fetch = require('node-fetch');
const { getConfig } = require('../config');
const { HttpsProxyAgent } = require('https-proxy-agent');

let globalAgent = null;

/**
 * 初始化 HTTP 客户端
 */
function initHTTPClient() {
    const config = getConfig();
    if (config.access.proxy) {
        try {
            globalAgent = new HttpsProxyAgent(config.access.proxy);
            console.log(`已配置代理: ${config.access.proxy}`);
        } catch (err) {
            console.error(`代理配置失败: ${err.message}`);
        }
    }
}

/**
 * 获取 fetch 选项
 */
function getFetchOptions(options = {}) {
    const result = { ...options };
    if (globalAgent) {
        result.agent = globalAgent;
    }
    return result;
}

/**
 * 发起 HTTP 请求
 */
async function httpFetch(url, options = {}) {
    return fetch(url, getFetchOptions(options));
}

module.exports = {
    initHTTPClient,
    getFetchOptions,
    httpFetch,
};
