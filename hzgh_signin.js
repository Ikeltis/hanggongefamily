#!/usr/bin/env node
/*
杭工e家 · 每日签到
cron: 19 9 * * *
*/
/**
 * 杭工e家 · 每日签到任务（面板版）
 * 流程：登录签到 → N 次日常签到 → 1 次评论 → 1 次查询积分
 * 结果汇总为「一条」通知推送（区别于原脚本每步都推）。
 *
 * 定时：上面那行 `cron:` 是订阅建任务时面板自动采用的声明。
 *       格式必须是「行首 + ASCII 冒号」的 `cron: <5 段表达式>`；
 *       写成「cron 建议：…」这类中文说明是解析不到的，任务会被塞默认值
 *       `0 0 * * *`（本仓库之前就踩过这个坑）。
 *
 * 依赖环境变量见 hzgh_lib_config.js / README。
 */

const CONFIG = require('./hzgh_lib_config.js');
const { encryptRequest } = require('./hzgh_lib_encrypt.js');
const { smartDecrypt } = require('./hzgh_lib_decrypt.js');
const { sendRequest } = require('./hzgh_lib_http.js');
// 通知交给面板：本仓库不再自带 sendNotify.js，面板会把这个 require 指向它自己的
// 托管版（导出的是对象，所以必须解构，直接当函数用会 TypeError）。
const { sendNotify } = require('./sendNotify.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildParams(account, functionName, extra = {}) {
    return {
        ...CONFIG.accountFields(account),
        timestamp: Date.now().toString(),
        ...CONFIG.functionsFor(account)[functionName],
        ...extra,
    };
}

/**
 * 执行一个功能，返回 { ok, msg, raw }
 */
async function runFunction(account, functionName, displayName) {
    const url = `${CONFIG.baseUrl}${CONFIG.endpoints[functionName]}`;
    console.log(`\n▶ ${displayName} ...`);
    try {
        const encrypted = encryptRequest(buildParams(account, functionName), CONFIG.baseUrl);
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

/**
 * 跑完一个账号的全套流程，返回给通知用的文本行。
 */
async function runAccount(account) {
    const lines = [];

    // 1) 登录签到
    const login = await runFunction(account, 'login', '登录签到');
    lines.push(`登录签到：${login.msg}`);

    // 2) N 次日常签到
    for (let i = 1; i <= CONFIG.signinTimes; i++) {
        const r = await runFunction(account, 'signin', `第 ${i} 次日常签到`);
        lines.push(`第${i}次签到：${r.msg}`);
        if (i < CONFIG.signinTimes) await sleep(CONFIG.signinGapMs);
    }

    // 3) 评论
    const comment = await runFunction(account, 'comment', '评论');
    lines.push(`评论：${comment.msg}`);

    // 4) 查询积分
    const query = await runFunction(account, 'query', '查询积分');
    // 查询接口通常直接把积分信息放在 raw 里
    let queryLine = `查询：${query.msg}`;
    if (query.raw) {
        const p = query.raw.point ?? query.raw.integral ?? query.raw.score ?? query.raw.total_point;
        if (p !== undefined) queryLine = `当前积分：${p}`;
    }
    lines.push(queryLine);

    return lines;
}

async function main() {
    console.log('🎯 杭工e家 · 每日签到任务');
    console.log('='.repeat(50));
    CONFIG.assertCredentials();

    const accounts = CONFIG.accounts;
    const multi = accounts.length > 1;
    if (multi) console.log(`共 ${accounts.length} 个账号，逐个执行`);

    const sections = [];
    for (const account of accounts) {
        if (multi) console.log(`\n${'─'.repeat(50)}\n👤 ${account.label}`);
        try {
            const lines = await runAccount(account);
            // 单账号时不加标题，输出与以前保持一致
            sections.push(multi ? `【${account.label}】\n${lines.join('\n')}` : lines.join('\n'));
        } catch (err) {
            // 一个账号出问题不能带崩其他账号
            console.error(`  ${account.label} 异常：${err.message}`);
            sections.push(`【${account.label}】\n❌ 异常：${err.message}`);
        }
    }

    const summary = sections.join('\n\n');
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
