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
const sendNotify = require('./sendNotify.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildExchangeParams() {
    return {
        ...CONFIG.commonFields,
        timestamp: Date.now().toString(),
        ...CONFIG.functions.exchange,
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

async function executeOnce(params, attempt) {
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
        console.log(`  第${attempt}次 → ${msg}`);

        if (msg === '兑换成功') return { done: true, success: true, msg, raw: data2Json };
        if (msg === '手慢啦，优惠券被抢光了') return { done: true, success: false, msg, raw: data2Json };
        // “手慢”类中间态 / 未开始 → 继续重试
        return { retry: true, msg, raw: data2Json, slow: isSlowResponse(data2Json) };
    } catch (err) {
        return { retry: true, msg: err.message };
    }
}

async function main() {
    console.log('🚀 杭工e家 · 定时抢券');
    console.log('='.repeat(50));
    CONFIG.assertCredentials();

    const ex = CONFIG.exchange;
    console.log(`券类型 exchange_id=${CONFIG.functions.exchange.exchange_id}（9=2元,10=4元,11=6元）`);

    // 时间校准
    let offsetMs = 0;
    if (ex.targetTime && ex.calibrate) {
        offsetMs = await getServerTimeOffset(CONFIG.baseUrl);
        console.log(`⏱️  服务器时间偏移：${offsetMs}ms`);
    }

    // 等待到点
    if (ex.targetTime) {
        const target = parseTargetToday(ex.targetTime);
        if (target == null) {
            console.log(`⚠️  HZGH_EXCHANGE_TIME 格式无效（应为 HH:MM:SS）：${ex.targetTime}，将立即开抢`);
        } else {
            const serverNow = Date.now() + offsetMs;
            if (target - serverNow > 0) {
                console.log(`🕒 目标开抢：${ex.targetTime}（提前 ${ex.leadMs}ms 发枪），等待中...`);
                await waitUntil(target, offsetMs, ex.leadMs);
            } else {
                console.log(`🕒 目标时刻已过，立即开抢`);
            }
        }
    } else {
        console.log('🕒 未设置目标时刻，立即开抢');
    }

    // 抢券循环（带硬上限）
    console.log('🔫 开抢！');
    const startMs = Date.now();
    let attempt = 0;
    let last = null;
    while (true) {
        attempt++;
        const params = buildExchangeParams();
        last = await executeOnce(params, attempt);
        if (last.done) break;

        if (Date.now() - startMs >= ex.maxDurationMs) {
            console.log(`⏹️  达到最大时长 ${ex.maxDurationMs}ms，停止`);
            break;
        }
        if (attempt >= ex.maxAttempts) {
            console.log(`⏹️  达到最大次数 ${ex.maxAttempts}，停止`);
            break;
        }
        await sleep(ex.intervalMs);
    }

    // 汇总通知
    const elapsed = Date.now() - startMs;
    let title, body;
    if (last && last.done && last.success) {
        title = '杭工e家 · 抢券成功 🎉';
        body = `结果：${last.msg}\n尝试次数：${attempt}\n耗时：${elapsed}ms`;
    } else if (last && last.done && !last.success) {
        title = '杭工e家 · 抢券结束（手慢啦）';
        body = `结果：${last.msg}\n尝试次数：${attempt}\n耗时：${elapsed}ms`;
    } else {
        title = '杭工e家 · 抢券结束（未成功）';
        body = `最后响应：${last ? last.msg : '无'}\n尝试次数：${attempt}\n耗时：${elapsed}ms`;
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
