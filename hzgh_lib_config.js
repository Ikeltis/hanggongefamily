/**
 * 面板配置模块：所有配置从环境变量读取（呆呆面板的变量注入）。
 * 作为共享库被任务脚本 require，不单独作为任务运行。
 *
 * 必填环境变量：
 *   HZGH_LOGIN_NAME  登录名(login_name)——从一次成功登录中获取的用户名令牌
 *   HZGH_SES_ID      会话ID(ses_id)
 *
 * 多账号：两个变量都用 `&` 分隔（也支持换行），按位置一一对应。例如
 *   HZGH_LOGIN_NAME = 甲的login_name&乙的login_name
 *   HZGH_SES_ID     = 甲的ses_id&乙的ses_id
 * 只填一个值就是单账号，跟以前完全一样，老配置不用改。
 *
 * 其余参数（签到次数、评论内容、券类型…）是全账号共用的，不做成一账号一套。
 *
 * 可选环境变量见下方 README / 各字段默认值。
 */

function env(name, def = '') {
    const v = process.env[name];
    if (v === undefined || v === null) return def;
    const t = String(v).trim();
    return t === '' ? def : t;
}

function envInt(name, def) {
    const n = parseInt(env(name, ''), 10);
    return Number.isFinite(n) ? n : def;
}

// 青龙习惯用 & 分隔多账号；面板文本框里手输容易带换行，一并当分隔符处理。
const ACCOUNT_SEPARATOR = /[&\n\r]+/;

function envList(name) {
    return env(name).split(ACCOUNT_SEPARATOR).map(s => s.trim()).filter(Boolean);
}

const LOGIN_NAMES = envList('HZGH_LOGIN_NAME');
const SES_IDS = envList('HZGH_SES_ID');
// 与 hzgh_login.py 保持一致。两边不一致时可能出现「取码正常但签到失败」这种难查的现象。
const APP_VER = env('HZGH_APP_VER', '3.1.7');

/**
 * 账号列表，按环境变量里的出现顺序一一配对。
 * 数量不一致时这里不报错，交给 assertCredentials 给出可读的提示。
 */
const ACCOUNTS = LOGIN_NAMES.map((loginName, i) => ({
    index: i + 1,
    label: `账号${i + 1}`,
    loginName,
    sesId: SES_IDS[i],
}));

// 校验必填项
function assertCredentials() {
    const missing = [];
    if (!LOGIN_NAMES.length) missing.push('HZGH_LOGIN_NAME');
    if (!SES_IDS.length) missing.push('HZGH_SES_ID');
    if (missing.length) {
        throw new Error(`缺少必填环境变量：${missing.join(', ')}。请在面板「环境变量」中添加后重试。`);
    }
    // 数量对不上就必须停：否则会把甲的 login_name 和乙的 ses_id 配成一个账号，
    // 请求还能发出去，但结果是错的，而且很难查。宁可直接失败。
    if (LOGIN_NAMES.length !== SES_IDS.length) {
        throw new Error(
            `多账号配置数量不一致：HZGH_LOGIN_NAME 有 ${LOGIN_NAMES.length} 个，` +
            `HZGH_SES_ID 有 ${SES_IDS.length} 个。两者必须用 & 分隔并一一对应，` +
            `否则会把某个账号的 login_name 和另一个账号的 ses_id 配在一起。`
        );
    }
}

// exchange_id：9=2元券, 10=4元券, 11=6元券
const EXCHANGE_ID = env('HZGH_EXCHANGE_ID', '10');

/**
 * 某个账号的公共请求字段（每个请求都会带上）。
 * 以前这是个模块级常量，多账号后必须按账号现算。
 */
function accountFields(account) {
    return {
        channel: '02',
        app_ver_no: APP_VER,
        login_name: account.loginName,
        ses_id: account.sesId,
    };
}

/**
 * 某个账号的各功能参数。只有 exchange 里的 user_id 与账号相关，
 * 其余是全账号共用的，但一并按账号返回，调用方不必区分。
 */
function functionsFor(account) {
    return {
        login: { type: '1' },
        signin: { type: '5' },
        comment: {
            related_id: env('HZGH_COMMENT_RELATED_ID', '1232'),
            content_type: '1',
            oper_type: '0',
            suffix: 'png',
            content: env('HZGH_COMMENT', '好'),
        },
        query: {},
        exchange: {
            user_id: account.loginName,
            exchange_id: EXCHANGE_ID,
        },
    };
}

module.exports = {
    // 基础
    baseUrl: 'https://app.hzgh.org.cn',

    // 账号列表（单账号时长度为 1）
    accounts: ACCOUNTS,
    accountFields,
    functionsFor,
    exchangeId: EXCHANGE_ID,

    // API 端点
    endpoints: {
        login: '/unionApp/interf/front/U/U042',
        signin: '/unionApp/interf/front/U/U042',
        comment: '/unionApp/interf/front/AC/AC08',
        query: '/unionApp/interf/front/U/U005',
        exchange: '/unionApp/interf/front/OL/OL41',
    },

    // 签到相关
    signinTimes: envInt('HZGH_SIGNIN_TIMES', 3),
    signinGapMs: envInt('HZGH_SIGNIN_GAP_MS', 1000),

    // 抢券(定时兑换)相关
    exchange: {
        // 目标开抢时刻，格式 "HH:MM:SS"（本地时区/面板 TZ）。留空则立即开抢。
        targetTime: env('HZGH_EXCHANGE_TIME', ''),
        // 是否用服务器时间(响应 Date 头)校准本地时钟，1=开启
        calibrate: env('HZGH_EXCHANGE_CALIBRATE', '1') === '1',
        // 提前多少毫秒发出第一枪（补偿网络/加密耗时）
        leadMs: envInt('HZGH_EXCHANGE_LEAD_MS', 150),
        // 每次尝试间隔(ms)
        intervalMs: envInt('HZGH_EXCHANGE_INTERVAL_MS', 100),
        // 最长持续时长(ms)——到点仍未出最终结果就停，避免死循环撞面板超时
        maxDurationMs: envInt('HZGH_EXCHANGE_MAX_MS', 15000),
        // 最大尝试次数上限
        maxAttempts: envInt('HZGH_EXCHANGE_MAX_ATTEMPTS', 200),
    },

    // 请求超时
    request: {
        timeout: envInt('HZGH_REQUEST_TIMEOUT_MS', 5000),
    },

    // 简单请求头（签到/评论/查询用，okhttp UA）
    headersSimple: {
        'Host': 'app.hzgh.org.cn',
        'Content-Type': 'text/plain;charset=utf-8',
        'Connection': 'Keep-Alive',
        'User-Agent': 'okhttp/3.4.2',
    },

    // 浏览器请求头（抢券用，贴近 App WebView）
    headersBrowser: {
        'Host': 'app.hzgh.org.cn',
        'Content-Type': 'application/json;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15; SM-9210 Build/AP2A.240905.003.F1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.7258.158 Mobile Safari/537.36;unionApp;HZGH',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://app.hzgh.org.cn:8123',
        'X-Requested-With': 'com.zjte.hanggongefamily',
        'Referer': 'https://app.hzgh.org.cn:8123/',
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    },

    assertCredentials,
};
