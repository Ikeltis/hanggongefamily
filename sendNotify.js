/**
 * 通用消息推送模块 sendNotify.js（青龙/呆呆面板风格，精简版）
 * 仅依赖 Node 内置 http/https，无需额外 npm 包。
 *
 * 支持通道（按需在面板「环境变量」里配置，未配置的自动跳过）：
 *   Bark        : BARK_PUSH(设备key或完整URL), BARK_SOUND, BARK_GROUP, BARK_ICON
 *   Telegram    : TG_BOT_TOKEN, TG_USER_ID  (可选 TG_API_HOST, 默认 api.telegram.org)
 *   Server酱    : PUSH_KEY (sctxxxx 走 sct.ftqq.com；其余走 sc.ftqq.com)
 *   PushPlus    : PUSH_PLUS_TOKEN (可选 PUSH_PLUS_USER 群组编码)
 *   企业微信机器人: QYWX_KEY (机器人 webhook 的 key)
 *   钉钉机器人   : DD_BOT_TOKEN(access_token), DD_BOT_SECRET(加签密钥, 可选)
 *   飞书机器人   : FSKEY (自定义机器人 webhook 的 token 段)
 *
 * 用法： const sendNotify = require('./sendNotify'); await sendNotify('标题', '正文');
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function request(method, urlStr, { headers = {}, body = null, timeout = 10000 } = {}) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: 'bad url' }); }
        const lib = u.protocol === 'http:' ? http : https;
        const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
        const opts = {
            method,
            hostname: u.hostname,
            port: u.port || (u.protocol === 'http:' ? 80 : 443),
            path: u.pathname + u.search,
            headers: { ...headers },
            timeout,
        };
        if (data != null) opts.headers['Content-Length'] = Buffer.byteLength(data);
        const req = lib.request(opts, (res) => {
            let buf = '';
            res.on('data', c => { buf += c; });
            res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: buf }));
        });
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
        if (data != null) req.write(data);
        req.end();
    });
}

const jsonHeaders = { 'Content-Type': 'application/json' };

async function bark(title, content) {
    let key = process.env.BARK_PUSH;
    if (!key) return null;
    let base;
    if (/^https?:\/\//.test(key)) base = key.replace(/\/$/, '');
    else base = `https://api.day.app/${key}`;
    const url = `${base}/${encodeURIComponent(title)}/${encodeURIComponent(content)}`;
    const params = new URLSearchParams();
    if (process.env.BARK_SOUND) params.set('sound', process.env.BARK_SOUND);
    if (process.env.BARK_GROUP) params.set('group', process.env.BARK_GROUP);
    if (process.env.BARK_ICON) params.set('icon', process.env.BARK_ICON);
    const qs = params.toString();
    const r = await request('GET', qs ? `${url}?${qs}` : url);
    return ['Bark', r.ok];
}

async function telegram(title, content) {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_USER_ID;
    if (!token || !chatId) return null;
    const host = process.env.TG_API_HOST || 'api.telegram.org';
    const url = `https://${host}/bot${token}/sendMessage`;
    const r = await request('POST', url, {
        headers: jsonHeaders,
        body: { chat_id: chatId, text: `${title}\n\n${content}`, disable_web_page_preview: true },
    });
    return ['Telegram', r.ok];
}

async function serverChan(title, content) {
    const key = process.env.PUSH_KEY;
    if (!key) return null;
    const url = key.startsWith('sct')
        ? `https://sctapi.ftqq.com/${key}.send`
        : `https://sc.ftqq.com/${key}.send`;
    const body = new URLSearchParams({ title, desp: content }).toString();
    const r = await request('POST', url, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    return ['Server酱', r.ok];
}

async function pushplus(title, content) {
    const token = process.env.PUSH_PLUS_TOKEN;
    if (!token) return null;
    const body = { token, title, content, template: 'txt' };
    if (process.env.PUSH_PLUS_USER) body.topic = process.env.PUSH_PLUS_USER;
    const r = await request('POST', 'https://www.pushplus.plus/send', { headers: jsonHeaders, body });
    return ['PushPlus', r.ok];
}

async function weCom(title, content) {
    const key = process.env.QYWX_KEY;
    if (!key) return null;
    const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
    const r = await request('POST', url, {
        headers: jsonHeaders,
        body: { msgtype: 'text', text: { content: `${title}\n\n${content}` } },
    });
    return ['企业微信', r.ok];
}

async function dingTalk(title, content) {
    const token = process.env.DD_BOT_TOKEN;
    if (!token) return null;
    let url = `https://oapi.dingtalk.com/robot/send?access_token=${token}`;
    const secret = process.env.DD_BOT_SECRET;
    if (secret) {
        const ts = Date.now();
        const sign = crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64');
        url += `&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
    }
    const r = await request('POST', url, {
        headers: jsonHeaders,
        body: { msgtype: 'text', text: { content: `${title}\n${content}` } },
    });
    return ['钉钉', r.ok];
}

async function feishu(title, content) {
    const key = process.env.FSKEY;
    if (!key) return null;
    const url = `https://open.feishu.cn/open-apis/bot/v2/hook/${key}`;
    const r = await request('POST', url, {
        headers: jsonHeaders,
        body: { msg_type: 'text', content: { text: `${title}\n${content}` } },
    });
    return ['飞书', r.ok];
}

/**
 * 加载呆呆面板托管的 sendNotify.js（scripts 根目录那个）。
 *
 * 面板会给任务进程注入 DAIDAI_SCRIPTS_DIR / DAIDAI_NOTIFY_URL / DAIDAI_NOTIFY_TOKEN，
 * 托管版据此 POST /api/notifications，走面板「通知设置」里已配好的渠道 —— 也就是说
 * 用户不必把 TG_BOT_TOKEN 之类再往环境变量里抄一份。
 *
 * 为什么按绝对路径加载、而不是 require('sendNotify')：
 * 面板给 Module._resolveFilename 打了别名补丁，但它在「本目录已存在同名文件」时会主动
 * 让路（见面板托管版源码）。本文件正是那个同名文件，所以别名会绕回自己，成死循环。
 *
 * 返回 null 表示不在面板环境里（青龙、本地直跑等），调用方自行降级为打印。
 *
 * @returns {{sendNotify: Function}|null}
 */
function loadPanelManagedNotify() {
    const candidates = [];
    if (process.env.DAIDAI_SCRIPTS_DIR) {
        candidates.push(path.join(process.env.DAIDAI_SCRIPTS_DIR, 'sendNotify.js'));
    }
    // 脚本一般位于 scripts/<仓库目录>/，托管版在其上一级
    candidates.push(path.join(__dirname, '..', 'sendNotify.js'));

    for (const candidate of candidates) {
        try {
            const abs = path.resolve(candidate);
            if (abs === path.resolve(__filename)) continue;      // 别把自己再加载一遍
            if (!fs.existsSync(abs)) continue;
            // 确认是面板托管版，避免误加载别处的同名文件
            if (!fs.readFileSync(abs, 'utf8').includes('DAIDAI_PANEL_MANAGED_NOTIFY_HELPER')) continue;
            const mod = require(abs);
            if (mod && typeof mod.sendNotify === 'function') return mod;
        } catch (_) {
            // 单个候选失败不影响其他候选
        }
    }
    return null;
}

/**
 * 推送到所有已配置的通道。
 * 都没配时先尝试交给面板自带的推送渠道，仍然不行才退化为打印到控制台。
 * @param {string} title 标题
 * @param {string} content 正文
 */
async function sendNotify(title, content) {
    content = content == null ? '' : String(content);
    const senders = [bark, telegram, serverChan, pushplus, weCom, dingTalk, feishu];
    const results = (await Promise.all(senders.map(fn => fn(title, content).catch(() => null)))).filter(Boolean);

    if (results.length === 0) {
        // 没配任何环境变量渠道时，尝试交给面板自己的推送（呆呆面板「通知设置」里配的渠道）。
        // 这样用户不必把 TG_BOT_TOKEN 之类再抄一份到环境变量里。
        const managed = loadPanelManagedNotify();
        if (managed) {
            try {
                await managed.sendNotify(title, content);
                console.log('📤 已交由面板通知渠道推送');
                return;
            } catch (e) {
                console.log(`⚠️  面板通知渠道推送失败：${e && e.message ? e.message : e}`);
            }
        }
        console.log('📭 未配置任何推送通道，消息仅打印如下：');
        console.log(`【${title}】\n${content}`);
        return;
    }
    const ok = results.filter(r => r[1]).map(r => r[0]);
    const fail = results.filter(r => !r[1]).map(r => r[0]);
    if (ok.length) console.log(`📤 推送成功：${ok.join('、')}`);
    if (fail.length) console.log(`⚠️  推送失败：${fail.join('、')}`);
}

module.exports = sendNotify;
module.exports.sendNotify = sendNotify;
