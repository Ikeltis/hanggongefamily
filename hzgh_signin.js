#!/usr/bin/env node
/**
 * 杭工e家 · 每日签到任务（面板版）
 * 流程：登录签到 → N 次日常签到 → 1 次评论 → 1 次查询积分
 * 结果汇总为「一条」通知推送（区别于原脚本每步都推）。
 *
 * cron 建议：每天早上执行一次，例如  8 8 * * *
 *
 * 依赖环境变量见 hzgh_lib_config.js / README。
 */

const CONFIG = require('./hzgh_lib_config.js');
const { encryptRequest } = require('./hzgh_lib_encrypt.js');
const { smartDecrypt } = require('./hzgh_lib_decrypt.js');
const { sendRequest } = require('./hzgh_lib_http.js');
const sendNotify = require('./sendNotify.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildParams(functionName, extra = {}) {
    return {
        ...CONFIG.commonFields,
        timestamp: Date.now().toString(),
        ...CONFIG.functions[functionName],
        ...extra,
    };
}

/**
 * 执行一个功能，返回 { ok, msg, raw }
 */
async function runFunction(functionName, displayName) {
    const url = `${CONFIG.baseUrl}${CONFIG.endpoints[functionName]}`;
    console.log(`\n▶ ${displayName} ...`);
    try {
        const encrypted = encryptRequest(buildParams(functionName), CONFIG.baseUrl);
        const res = await sendRequest(url, encrypted, CONFIG.headersSimple, CONFIG.request.timeout);
        if (res.statusCode !== 200) {
            console.log(`  HTTP ${res.statusCode}`);
            return { ok: false, msg: `HTTP ${res.statusCode}` };
        }
        let responseJson;
        try {
            responseJson = JSON.parse(res.data);
        } catch (_) {
            return { ok: false, msg: '响应非 JSON' };
        }
        if (!responseJson.data2) {
            const msg = responseJson.msg || '响应无 data2';
            console.log(`  ${msg}`);
            return { ok: false, msg };
        }
        const decrypted = await smartDecrypt(responseJson);
        let data2Json;
        try {
            data2Json = JSON.parse(decrypted.data2);
        } catch (_) {
            return { ok: false, msg: 'data2 解析失败' };
        }
        const msg = data2Json.msg || '(无 msg)';
        console.log(`  结果：${msg}`);
        // 常见成功标志：result 000000 或 msg 含“成功”
        const ok = data2Json.result === '000000' || /成功|已签到|重复/.test(msg);
        return { ok, msg, raw: data2Json };
    } catch (err) {
        console.log(`  失败：${err.message}`);
        return { ok: false, msg: err.message };
    }
}

async function main() {
    console.log('🎯 杭工e家 · 每日签到任务');
    console.log('='.repeat(50));
    CONFIG.assertCredentials();

    const lines = [];

    // 1) 登录签到
    const login = await runFunction('login', '登录签到');
    lines.push(`登录签到：${login.msg}`);

    // 2) N 次日常签到
    for (let i = 1; i <= CONFIG.signinTimes; i++) {
        const r = await runFunction('signin', `第 ${i} 次日常签到`);
        lines.push(`第${i}次签到：${r.msg}`);
        if (i < CONFIG.signinTimes) await sleep(CONFIG.signinGapMs);
    }

    // 3) 评论
    const comment = await runFunction('comment', '评论');
    lines.push(`评论：${comment.msg}`);

    // 4) 查询积分
    const query = await runFunction('query', '查询积分');
    // 查询接口通常直接把积分信息放在 raw 里
    let queryLine = `查询：${query.msg}`;
    if (query.raw) {
        const p = query.raw.point ?? query.raw.integral ?? query.raw.score ?? query.raw.total_point;
        if (p !== undefined) queryLine = `当前积分：${p}`;
    }
    lines.push(queryLine);

    const summary = lines.join('\n');
    console.log('\n' + '='.repeat(50));
    console.log('📋 汇总：\n' + summary);

    await sendNotify('杭工e家 · 签到结果', summary);
}

if (require.main === module) {
    main().catch(async (err) => {
        console.error('❌ 任务异常：', err.message);
        try { await sendNotify('杭工e家 · 签到异常', err.message); } catch (_) {}
        process.exitCode = 1;
    });
}

module.exports = { main };
