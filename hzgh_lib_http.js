/**
 * HTTP 请求助手（共享库）。仅用 Node 内置 https。
 * 注意：沿用原项目的 rejectUnauthorized:false（关闭 TLS 校验）以兼容目标服务器，
 * 详见 README「安全须知」。
 */

const https = require('https');
const { URL } = require('url');

/**
 * 发送 POST 请求。
 * @param {string} url    完整 URL
 * @param {string} data   请求体
 * @param {Object} headers 请求头
 * @param {number} timeout 超时(ms)
 * @returns {Promise<{statusCode:number, data:string, headers:Object}>}
 */
function sendRequest(url, data, headers = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: { ...headers, 'Content-Length': Buffer.byteLength(data) },
            rejectUnauthorized: false,
            timeout,
        };
        const req = https.request(options, (res) => {
            let buf = '';
            res.on('data', c => { buf += c; });
            res.on('end', () => resolve({ statusCode: res.statusCode, data: buf, headers: res.headers }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
        req.write(data);
        req.end();
    });
}

/**
 * 通过一次 HEAD 请求读取服务器 Date 头，估算「服务器时间 - 本地时间」偏移(ms)。
 * 用于抢券对齐服务器时钟。失败返回 0（即不校准）。
 * @param {string} baseUrl 例如 https://app.hzgh.org.cn
 */
function getServerTimeOffset(baseUrl) {
    return new Promise((resolve) => {
        const u = new URL(baseUrl);
        const options = {
            hostname: u.hostname,
            port: u.port || 443,
            path: '/',
            method: 'HEAD',
            rejectUnauthorized: false,
            timeout: 4000,
        };
        const t0 = Date.now();
        const req = https.request(options, (res) => {
            const t1 = Date.now();
            res.resume();
            const dateHeader = res.headers && res.headers.date;
            if (!dateHeader) return resolve(0);
            const serverMs = new Date(dateHeader).getTime();
            if (!Number.isFinite(serverMs)) return resolve(0);
            // 用请求往返中点对齐本地时刻，减少单边网络延迟影响
            const localMid = t0 + (t1 - t0) / 2;
            resolve(Math.round(serverMs - localMid));
        });
        req.on('error', () => resolve(0));
        req.on('timeout', () => { req.destroy(); resolve(0); });
        req.end();
    });
}

module.exports = { sendRequest, getServerTimeOffset };
