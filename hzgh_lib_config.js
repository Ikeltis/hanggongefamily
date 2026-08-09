/**
 * 面板配置模块：所有配置从环境变量读取（兼容青龙/呆呆面板的变量注入）。
 * 单账号版本。作为共享库被任务脚本 require，不单独作为任务运行。
 *
 * 必填环境变量：
 *   HZGH_LOGIN_NAME  登录名(login_name)——从一次成功登录中获取的用户名令牌
 *   HZGH_SES_ID      会话ID(ses_id)
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

const LOGIN_NAME = env('HZGH_LOGIN_NAME');
const SES_ID = env('HZGH_SES_ID');
const APP_VER = env('HZGH_APP_VER', '3.1.4');

// 校验必填项
function assertCredentials() {
    const missing = [];
    if (!LOGIN_NAME) missing.push('HZGH_LOGIN_NAME');
    if (!SES_ID) missing.push('HZGH_SES_ID');
    if (missing.length) {
        throw new Error(`缺少必填环境变量：${missing.join(', ')}。请在面板「环境变量」中添加后重试。`);
    }
}

module.exports = {
    // 基础
    baseUrl: 'https://app.hzgh.org.cn',
    loginName: LOGIN_NAME,
    sesId: SES_ID,

    // 公共请求字段（每个请求都会带上）
    commonFields: {
        channel: '02',
        app_ver_no: APP_VER,
        login_name: LOGIN_NAME,
        ses_id: SES_ID,
    },

    // API 端点
    endpoints: {
        login: '/unionApp/interf/front/U/U042',
        signin: '/unionApp/interf/front/U/U042',
        comment: '/unionApp/interf/front/AC/AC08',
        query: '/unionApp/interf/front/U/U005',
        exchange: '/unionApp/interf/front/OL/OL41',
    },

    // 各功能参数
    functions: {
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
        // exchange_id：9=2元券, 10=4元券, 11=6元券
        exchange: {
            user_id: LOGIN_NAME,
            exchange_id: env('HZGH_EXCHANGE_ID', '10'),
        },
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
