/**
 * 访问控制中间件
 * 对应原 Go 项目的 utils/access_control.go
 */

const { getConfig } = require('../config');

/**
 * 通配符匹配
 */
function wildcardMatch(pattern, str) {
    // 转换通配符模式为正则表达式
    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
        .replace(/\*/g, '.*') // * -> .*
        .replace(/\?/g, '.'); // ? -> .

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(str);
}

/**
 * 检查仓库是否在列表中匹配
 */
function matchesPattern(repoPath, patterns) {
    for (const pattern of patterns) {
        if (wildcardMatch(pattern, repoPath)) {
            return true;
        }
    }
    return false;
}

/**
 * 检查 GitHub 访问权限
 * @param {string} username - 用户名
 * @param {string} repoName - 仓库名
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkGitHubAccess(username, repoName) {
    const config = getConfig();
    const { whiteList, blackList } = config.access;

    // 移除 .git 后缀
    const cleanRepoName = repoName.replace(/\.git$/, '');
    const repoPath = `${username}/${cleanRepoName}`;

    // 如果有白名单，必须在白名单中
    if (whiteList && whiteList.length > 0) {
        if (!matchesPattern(repoPath, whiteList)) {
            return { allowed: false, reason: '该仓库不在白名单中' };
        }
    }

    // 检查黑名单
    if (blackList && blackList.length > 0) {
        if (matchesPattern(repoPath, blackList)) {
            return { allowed: false, reason: '该仓库在黑名单中' };
        }
    }

    return { allowed: true, reason: '' };
}

/**
 * 检查 Docker 镜像访问权限
 * @param {string} imageName - 镜像名称
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkDockerAccess(imageName) {
    const config = getConfig();
    const { whiteList, blackList } = config.access;

    // 如果有白名单，必须在白名单中
    if (whiteList && whiteList.length > 0) {
        if (!matchesPattern(imageName, whiteList)) {
            return { allowed: false, reason: '该镜像不在白名单中' };
        }
    }

    // 检查黑名单
    if (blackList && blackList.length > 0) {
        if (matchesPattern(imageName, blackList)) {
            return { allowed: false, reason: '该镜像在黑名单中' };
        }
    }

    return { allowed: true, reason: '' };
}

module.exports = {
    checkGitHubAccess,
    checkDockerAccess,
    wildcardMatch,
    matchesPattern,
};
