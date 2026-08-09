/**
 * 杭工e家 · QuantumultX 抓包取码脚本
 * ------------------------------------------------------------
 * 作用：从已登录的「杭工e家」App 请求里，自动抓取 ses_id（明文传输），
 *       存到本地并弹通知，方便复制到面板环境变量 HZGH_SES_ID。
 *
 * 为什么只抓 ses_id：
 *   - ses_id 在请求体里是明文，直接读即可；它会过期、需反复刷新，自动化价值最大。
 *   - login_name 在请求里是 3DES 加密的，且每次请求用的是**随机会话密钥**
 *     （dec_key，由服务器公钥保护）。所以传输中的 login_name 每次都不一样，
 *     既不能照抄复用、也无法在此解密。它不是手机号，而是一枚长期不变的用户令牌，
 *     请改用 hzgh_login.py 登录一次拿到明文，填进 HZGH_LOGIN_NAME（之后基本不用再动）。
 *
 * 用法：作为 QuantumultX 的 rewrite，匹配 app.hzgh.org.cn 的接口请求，
 *       类型用 script-request-body（见随附 hzgh.snippet 配置）。
 *
 * 兼容：QuantumultX（主）/ Surge / Loon / Stash（做了 store 与 notify 兜底）。
 * ------------------------------------------------------------
 */

const KEY_SES = "hzgh_ses_id";

// ---------- 跨 App 的存储 / 通知兜底 ----------
function store_get(key) {
  if (typeof $prefs !== "undefined") return $prefs.valueForKey(key);
  if (typeof $persistentStore !== "undefined") return $persistentStore.read(key);
  return null;
}
function store_set(val, key) {
  if (typeof $prefs !== "undefined") return $prefs.setValueForKey(val, key);
  if (typeof $persistentStore !== "undefined") return $persistentStore.write(val, key);
  return false;
}
function notify(title, subtitle, body) {
  if (typeof $notify !== "undefined") $notify(title, subtitle, body);
  else if (typeof $notification !== "undefined") $notification.post(title, subtitle, body);
  console.log(`${title} | ${subtitle} | ${body}`);
}

// ---------- 主逻辑 ----------
(function main() {
  const body =
    typeof $request !== "undefined" && $request && $request.body ? $request.body : "";
  if (!body) return finish();

  let obj;
  try {
    obj = JSON.parse(body);
  } catch (e) {
    console.log("[hzgh] 请求体非 JSON，跳过：" + e);
    return finish();
  }

  // 抓 ses_id（明文传输，可直接复用到面板 HZGH_SES_ID）
  const ses = obj.ses_id || obj.sesId || "";
  if (ses) {
    const prev = store_get(KEY_SES);
    if (ses !== prev) {
      store_set(ses, KEY_SES);
      notify(
        "杭工e家 · 抓到 ses_id ✅",
        "已更新，请复制到面板 HZGH_SES_ID",
        `ses_id: ${ses}`
      );
    } else {
      console.log("[hzgh] ses_id 未变化，不重复提醒");
    }
  }

  // 注：login_name 在传输中是随机密钥的 3DES 密文，抓不到可用的明文；
  //     请用 hzgh_login.py 登录一次拿到明文（长期不变），此处不再尝试。

  finish();
})();

// request 脚本：不修改请求，原样放行
function finish() {
  if (typeof $done !== "undefined") $done({});
}
