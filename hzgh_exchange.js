#!/usr/bin/env node
/*
杭工e家 · 定时抢券
cron: 0 0 1 1 *
*/
/**
 * 杭工e家 · 定时抢券（定时兑换）任务（面板版）
 *
 * 与原 AutoTicket.js 的区别：
 *   1. 支持「等到目标时刻再开抢」(HZGH_EXCHANGE_TIME)，并可用服务器时间校准；
 *   2. 有「最大时长 / 最大次数」硬上限，避免在面板里死循环撞超时；
 *   3. 结果只推送一条通知。
 *
 * 定时：上面声明的 `0 0 1 1 *` 是每年 1 月 1 日零点，等于「基本不自动跑」。
 *       开抢时刻取决于当期活动，没有通用值，所以默认给一个无害的年度触发占位，
 *       知道开抢时间后再进面板改。
 *
 *       （不声明 `cron:` 的话，面板建任务时会塞默认的 `0 0 * * *`，反而每晚空跑。）
 *
 *       改法：把 cron 排在开抢时刻「前 1~2 分钟」，脚本内部自旋等待到点开抢。
 *       例如 12:00 开抢 → cron 设 `58 11 * * *`，并设 HZGH_EXCHANGE_TIME=12:00:00
 *
 * exchange_id：9=2元券, 10=4元券, 11=6元券（HZGH_EXCHANGE_ID）
 */

const CONFIG = require('./hzgh_lib_config.js');
const { encryptRequest, isSlowResponse } = require('./hzgh_lib_encrypt.js');
const { smartDecrypt } = require('./hzgh_lib_decrypt.js');
const { sendRequest, getServerTimeOffset } = require('./hzgh_lib_http.js');
// 通知交给面板：本仓库不再自带 sendNotify.js，面板会把这个 require 指向它自己的
// 托管版（导出的是对象，所以必须解构，直接当函数用会 TypeError）。
const { sendNotify } = require('./sendNotify.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildExchangeParams(account) {
    return {
        ...CONFIG.accountFields(account),
        timestamp: Date.now().toString(),
        ...CONFIG.functionsFor(account).exchange,
    };
}

/**
 * 解析 "HH:MM:SS" 为「今天该时刻」的本地毫秒时间戳。
 * 若该时刻已过去，返回过去的时间戳（调用方据此判定立即开抢）。
 */
function parseTargetToday(hhmmss) {
    const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(hhmmss.trim());
    if (!m) return null;
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
        parseInt(m[1], 10), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : 0, 0);
    return d.getTime();
}

/**
 * 自旋等待到目标本地时刻（用服务器偏移校准）。
 * 最后 300ms 用忙等提高精度。
 */
async function waitUntil(targetLocalMs, offsetMs, leadMs) {
    const fireAt = targetLocalMs - leadMs; // 提前量：补偿加密+网络耗时
    while (true) {
        const serverNow = Date.now() + offsetMs;
        const remain = fireAt - serverNow;
        if (remain <= 0) break;
        if (remain > 300) await sleep(remain - 200);
        else await sleep(5); // 临近时快速轮询
    }
}

async function executeOnce(params, attempt, tag = '') {
    const url = `${CONFIG.baseUrl}${CONFIG.endpoints.exchange}`;
    try {
        const encrypted = encryptRequest(params, CONFIG.baseUrl);
        const res = await sendRequest(url, encrypted, CONFIG.headersBrowser, CONFIG.request.timeout);
        if (res.statusCode !== 200) {
            return { retry: true, msg: `HTTP ${res.statusCode}` };
        }
        const responseJson = JSON.parse(res.data);
        if (!responseJson.data2) return { retry: true, msg: '无 data2' };
        const decrypted = await smartDecrypt(responseJson);
        const data2Json = JSON.parse(decrypted.data2);
        const msg = data2Json.msg || '';
        console.log(`  ${tag}第${attempt}次 → ${msg}`);

        if (msg === '兑换成功') return { done: true, success: true, msg, raw: data2Json };
        if (msg === '手慢啦，优惠券被抢光了') return { done: true, success: false, msg, raw: data2Json };
        // “手慢”类中间态 / 未开始 → 继续重试
        return { retry: true, msg, raw: data2Json, slow: isSlowResponse(data2Json) };
    } catch (err) {
        return { retry: true, msg: err.message };
    }
}

/**
 * 单个账号的抢券循环（带硬上限）。
 * offsetMs / target 由 main 统一算好传进来——校准只做一次，不必每个账号各发一次请求。
 */
async function runAccount(account, offsetMs, target, tag) {
    const ex = CONFIG.exchange;

    if (target != null) {
        const serverNow = Date.now() + offsetMs;
        if (target - serverNow > 0) await waitUntil(target, offsetMs, ex.leadMs);
    }

    const startMs = Date.now();
    let attempt = 0;
    let last = null;
    while (true) {
        attempt++;
        last = await executeOnce(buildExchangeParams(account), attempt, tag);
        if (last.done) break;

        if (Date.now() - startMs >= ex.maxDurationMs) {
            console.log(`⏹️  ${tag}达到最大时长 ${ex.maxDurationMs}ms，停止`);
            break;
        }
        if (attempt >= ex.maxAttempts) {
            console.log(`⏹️  ${tag}达到最大次数 ${ex.maxAttempts}，停止`);
            break;
        }
        await sleep(ex.intervalMs);
    }

    return { account, last, attempt, elapsed: Date.now() - startMs };
}

/** 把单个账号的结果转成一行文字。 */
function describe(result) {
    const { last, attempt, elapsed } = result;
    const outcome = last && last.done
        ? `${last.success ? '✅' : '❌'} ${last.msg}`
        : `⏹️ 未出最终结果（最后响应：${last ? last.msg : '无'}）`;
    return `${outcome}\n尝试次数：${attempt}　耗时：${elapsed}ms`;
}

async function main() {
    console.log('🚀 杭工e家 · 定时抢券');
    console.log('='.repeat(50));
    CONFIG.assertCredentials();

    const ex = CONFIG.exchange;
    const accounts = CONFIG.accounts;
    const multi = accounts.length > 1;
    console.log(`券类型 exchange_id=${CONFIG.exchangeId}（9=2元,10=4元,11=6元）`);
    if (multi) console.log(`共 ${accounts.length} 个账号，将同时开抢`);

    // 时间校准：只做一次，所有账号共用同一个偏移量
    let offsetMs = 0;
    if (ex.targetTime && ex.calibrate) {
        offsetMs = await getServerTimeOffset(CONFIG.baseUrl);
        console.log(`⏱️  服务器时间偏移：${offsetMs}ms`);
    }

    // 解析目标时刻（null 表示立即开抢）
    let target = null;
    if (ex.targetTime) {
        target = parseTargetToday(ex.targetTime);
        if (target == null) {
            console.log(`⚠️  HZGH_EXCHANGE_TIME 格式无效（应为 HH:MM:SS）：${ex.targetTime}，将立即开抢`);
        } else if (target - (Date.now() + offsetMs) > 0) {
            console.log(`🕒 目标开抢：${ex.targetTime}（提前 ${ex.leadMs}ms 发枪），等待中...`);
        } else {
            console.log('🕒 目标时刻已过，立即开抢');
        }
    } else {
        console.log('🕒 未设置目标时刻，立即开抢');
    }

    // 所有账号并发开抢。抢券是掐点的：串行的话第二个账号要等第一个的窗口
    // （默认 15 秒）跑完才开始，整场都错过了。
    console.log('🔫 开抢！');
    const results = await Promise.all(accounts.map(account =>
        runAccount(account, offsetMs, target, multi ? `[${account.label}] ` : '')
            .catch(err => ({ account, error: err, attempt: 0, elapsed: 0, last: null }))
    ));

    // 汇总通知
    const anySuccess = results.some(r => r.last && r.last.done && r.last.success);
    let title, body;
    if (multi) {
        const okCount = results.filter(r => r.last && r.last.done && r.last.success).length;
        title = okCount > 0
            ? `杭工e家 · 抢券 ${okCount}/${accounts.length} 成功 🎉`
            : '杭工e家 · 抢券结束（无人成功）';
        body = results.map(r => r.error
            ? `【${r.account.label}】\n❌ 异常：${r.error.message}`
            : `【${r.account.label}】\n${describe(r)}`
        ).join('\n\n');
    } else {
        const r = results[0];
        if (r.error) {
            title = '杭工e家 · 抢券异常';
            body = `❌ 异常：${r.error.message}`;
        } else {
            title = anySuccess ? '杭工e家 · 抢券成功 🎉'
                : (r.last && r.last.done) ? '杭工e家 · 抢券结束（手慢啦）'
                : '杭工e家 · 抢券结束（未成功）';
            body = describe(r);
        }
    }
    console.log('\n' + '='.repeat(50));
    console.log(`📋 ${title}\n${body}`);
    await sendNotify(title, body);
}

if (require.main === module) {
    main().catch(async (err) => {
        console.error('❌ 任务异常：', err.message);
        try { await sendNotify('杭工e家 · 抢券异常', err.message); } catch (_) {}
        process.exitCode = 1;
    });
}

module.exports = { main };
