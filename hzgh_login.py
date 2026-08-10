#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
杭工e家 · 登录取码工具（面板手动运行版）
===========================================

用途：短信/密码登录，拿到 login_name 与 ses_id，填进面板环境变量
      HZGH_LOGIN_NAME / HZGH_SES_ID 供 hzgh_signin.js / hzgh_exchange.js 使用。

为什么是「手动运行」而非定时任务：
    短信登录需要人眼看图形验证码、手动输入手机收到的短信码，
    无法在无人值守的 cron 里自动完成。ses_id 会过期，过期后重跑一次即可。

面板适配点：
    * 图形验证码不落地成文件，而是打印成 data:image/jpeg;base64,... —
      直接把这一整行粘到浏览器地址栏就能看图（面板终端看不了图片文件）。
    * 登录成功后直接打印 HZGH_LOGIN_NAME / HZGH_SES_ID，复制到环境变量即可。

依赖：requests、pycryptodome  （见 requirements.txt，面板「依赖管理」pip 安装）

用法：
    python hzgh_login.py              # 交互式登录（默认短信登录）
    python hzgh_login.py --check      # 校验环境变量里现有 ses_id 是否仍有效
"""

import sys
import time
import json
import base64
import random
import string
import hashlib
import argparse
import os

try:
    import requests
    import urllib3
    from Crypto.PublicKey import RSA
    from Crypto.Signature import pkcs1_15
    from Crypto.Hash import SHA256
    from Crypto.Cipher import DES3, PKCS1_v1_5
    from Crypto.Util.Padding import pad
except ImportError as e:
    sys.stderr.write(
        "缺少依赖：%s\n请先安装：pip install requests pycryptodome\n"
        "（面板可在「依赖管理」里安装 requests 和 pycryptodome）\n" % e
    )
    sys.exit(1)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ================= 接口与密钥（逆向所得，与原项目一致） =================
BASE_URL = "https://app.hzgh.org.cn"
ENDPOINTS = {
    "captcha":  "/unionApp/interf/front/U/U067",   # 图形验证码
    "login":    "/unionApp/interf/front/U/U004",    # 密码登录
    "smsSend":  "/unionApp/interf/front/SMS/SMS1",  # 发送短信验证码
    "smsLogin": "/unionApp/interf/front/U/U065",    # 短信验证码登录
    "query":    "/unionApp/interf/front/U/U005",    # 查询用户信息（用于校验 ses_id）
}

CHANNEL = "02"
# 与 hzgh_lib_config.js 的 APP_VER 保持一致，改一处要改两处。
APP_VER_NO = os.environ.get("HZGH_APP_VER", "3.1.7")

ENCRYPTION_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7yWoQaojBBqKI2H0j4e8ZeX/n1yip6hxrxSVth5F5n1JJ/B3liPMdz6K1chNLFTAcbI7hTL9KkphP9yQ+bPYD68Ajrt/DFrW679Zi1CoeetHVrM4sF68lYarGXwnSlKloaPWnI4Ch9cSqIvIOInlpeJqYPlJ8ZJvGCmbQoM6bewIDAQAB
-----END PUBLIC KEY-----"""

SIGNING_PRIVATE_KEY_PEM = """-----BEGIN PRIVATE KEY-----
MIICeAIBADANBgkqhkiG9w0BAQEFAASCAmIwggJeAgEAAoGBAJ+C8Z9awsGU8DeB
pq47p+pVBgIxWr9epYE5lTrVwoTvOv7dOBTsNgYPgDqFLbU8eZsV26DOvgd4TC5t
ZUWF7WbAleOcxvwA143XTBpZEeDx6who8KiW1WBKUwkeEfXZvOWhN2d+8GlCjvJu
2J4yNGEXScQEIWb+ofE4Pd4yPkkzAgMBAAECgYB0Tzu18a0vEFX0c1JBm3g98w81
jB1aiz3tMzqwMuvqmLIQ4uegwfhGhQkAItoIW/dj8RU7dWS096+87sG4ZwaKCv/S
mT1CibqmSATrX6YNIFU4uXsZzMREJxmZi+V5AllT9DWBG5YjKgrGfWjL0Rq10Zvx
YMTdjO+SbqDIjVoc+QJBAOrMXRO6G349NpLvo1QPevxIykKNKhr5Qkjv4oVydoVo
HW6iMU30PhrBqBYla+K8W+xyeqrjd9ucDQFW/Z2+hD8CQQCt6jz4o7qadQM0giko
BsgWwp7teyZI/8ZH5htrKZwDJzUe6LuM9xjDeXAqqjNjQrDL7M+6T7ZwMmK3UN3b
oe4NAkEA6ioGabYh1TSXSNNVwG/v58twbA78/wm34aXb89rD+Shssflv0p7TkTuxt
uR7RBU2WAmT7PoOfyaSkdN/++IVYQJBAJ/klCvQc/YfkFPNO0N2gK0UP4N8zmUc
6tIdh6XNeocXm+oP9KaUYusMkghXtKkUnnDOBul28fdTC5kYOvD7fl0CQQDLIYfo
8MSMgcFkBH1wRUbhjVv31bk8+4G9a+h7UkLdLtch5qPsS7bsFCyszqEYjhYtQ278
Q20lSzaIsom0Q3ai
-----END PRIVATE KEY-----"""

SIGN_KEY_NEW = "zSw3MLRV7VuwT!*G"

# data2 响应解密用的 RSA 私钥
PRIVATE_KEY_PEM = """-----BEGIN RSA PRIVATE KEY-----
MIICdQIBADANBgkqhkiG9w0BAQEFAASCAl8wggJbAgEAAoGBAIOBMtf2AIYQlrNy
/lVPHx4R/LKI+Vtk3bKmzID8vdVnh/4WA3lczqfejM10Xfy3sNe4l5EeQTvnDgUH
bIFK8FyJRpvypAmS9oyW6uwGTjZEu5Y6hsSxiGAOG5ZOlH8vOSfuaAkZ+iUlqifP
E3ZOmHkqGzmukg4wCRaPLx5ioq8zAgMBAAECgYAgLOVmx677HmXxBCrMbq57agU9
HZx9SyGfS4Zv7Ob5pvo0Jei1sgpyMlabEmTIp50iOu0CubdWU8MvYdCfldlXQLW7
cjk8N1NyGQLFd2fJ03a7gGWnwwEdPoNTpSHnB+mDL9l7MVjion5fLojzq9Pz1gMK
L01I2TfZBDL4m6EbgQJBAMfgrMKtj7f40GA3qp/y/9/eBCAu8PbtFmtATLMQRf4t
Ghjvn349x1b6FZj8RiaRBSrq0Owjrdo5TUxgfS7dz3MCQQCobdWk2SQhRlqEHfFE
ro/8ab6gn3GhBDzzKvNjhKr2MO6JWqs+Vr+/P9uYpA+G+rv74uVIGWhjuNtI5+/6
9DFBAkAJOQS/tuJ6yrBSwD7PQpcr7UKjeYcE3cu7ByyC1q1kHRCnNedWG+Omz8NP
W9Sg0vA6GrupKbxL5Xj7nTgpgXKhAkBIVlvioAvfaqrngUClAd//RZ9EtxYDVKGk
wnaj8E/Iyr04KsPPU0ypJBD5XsT4cOmZxho5PAhUhAlSJ6MvAf/BAkA64ieVhtQA
1KV0pSSEJMnbPlZe+yBYGTWLMaG2zL0kKEhIs2fIHbVhLFQ8TkO5oH+mhxuuXI5+
nVU2G0dqUl6D
-----END RSA PRIVATE KEY-----"""

# ================= 加解密工具 =================
def rand_str(n):
    return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(n))

def rsa_encrypt(pub_pem, s):
    cipher = PKCS1_v1_5.new(RSA.importKey(pub_pem))
    return base64.b64encode(cipher.encrypt(s.encode("utf-8"))).decode("utf-8")

def des3_ecb_pkcs7_encrypt(key24, plaintext):
    cipher = DES3.new(key24.encode("utf-8"), DES3.MODE_ECB)
    padded = pad(plaintext.encode("utf-8"), DES3.block_size, style="pkcs7")
    return base64.b64encode(cipher.encrypt(padded)).decode("utf-8")

def rsa_sha256_sign(private_key_pem, data_string):
    key = RSA.import_key(private_key_pem)
    h = SHA256.new(data_string.encode("utf-8"))
    return base64.b64encode(pkcs1_15.new(key).sign(h)).decode("utf-8")

def pkcs7_unpad(data):
    return data[: -data[-1]]

def decrypt_data2(data2):
    rsa_enc_bytes = base64.b64decode(data2[:172])
    des_enc_bytes = base64.b64decode(data2[172:])
    a = PKCS1_v1_5.new(RSA.importKey(PRIVATE_KEY_PEM)).decrypt(rsa_enc_bytes, None).decode()
    key = ("HTt0Hzsu" + a).encode()
    iv = a[:8].encode()
    decrypted = DES3.new(key, DES3.MODE_CBC, iv).decrypt(des_enc_bytes)
    return pkcs7_unpad(decrypted).decode()

# ================= HTTP 会话 =================
session = requests.Session()
session.headers.update({
    "Host": "app.hzgh.org.cn",
    "Connection": "keep-alive",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "okhttp/3.4.2",
    "Content-Type": "application/json;charset=UTF-8",
    "Accept-Encoding": "gzip, deflate",
})

def _sign_and_post(endpoint_key, payload, encrypt_keys=None):
    """公共流程：塞 dec_key → 3DES 加密敏感字段 → 计算 key/sign → POST → 解密 data2。"""
    m = rand_str(24).upper()
    payload["dec_key"] = rsa_encrypt(ENCRYPTION_PUBLIC_KEY_PEM, m)
    for k in (encrypt_keys or []):
        if k in payload:
            payload[k] = des3_ecb_pkcs7_encrypt(m, str(payload[k]))
    keys_for_sign = list(payload.keys())
    values_concat = "".join(str(v) for v in payload.values())
    payload["key"] = ",".join(keys_for_sign)
    payload["sign"] = rsa_sha256_sign(SIGNING_PRIVATE_KEY_PEM, values_concat + SIGN_KEY_NEW)

    resp = session.post(BASE_URL + ENDPOINTS[endpoint_key], json=payload, verify=False, timeout=20)
    resp_json = resp.json()
    if "data2" not in resp_json:
        return None, resp_json
    return json.loads(decrypt_data2(resp_json["data2"])), resp_json

def _base_payload():
    return {
        "channel": CHANNEL,
        "app_ver_no": APP_VER_NO,
        "timestamp": str(int(time.time() * 1000)),
        "term_sys_ver": "12",
        "root": "0",
        "term_sys": "2",
        "model": "24031PN0DC",
        "term_id": "42e85afdd7e346e5",
    }

# ================= 业务：验证码 / 短信 / 登录 =================
def get_captcha():
    payload = _base_payload()
    payload["trcode"] = "U/U067"
    data, raw = _sign_and_post("captcha", payload)
    if not data or data.get("result") != "0":
        print("[-] 获取图形验证码失败：", (data or raw))
        return None
    return data

def show_captcha(captcha_data):
    """把图形验证码打印成 data URL，粘到浏览器地址栏即可查看。"""
    img = captcha_data.get("img", "")
    if not img:
        print("[-] 验证码响应里没有图片字段")
        return
    # 服务端返回的 base64 自带换行（MIME 76 列风格），直接打印会跨几十行，
    # 「复制下面一整行」就成了假话——粘到地址栏只会得到半张破图。这里压成真正的一行。
    img = "".join(img.split())
    data_url = img if img.startswith("data:") else "data:image/jpeg;base64," + img
    print("\n" + "=" * 60)
    print("👇 复制下面一整行，粘到浏览器地址栏回车，即可看到图形验证码：")
    print(data_url)
    print("=" * 60 + "\n")

def send_sms(captcha_data, phone, img_auth_code, sms_type="10"):
    payload = _base_payload()
    payload.pop("term_id", None)  # 与原始 SMS1 请求对齐
    payload.update({
        "login_name": phone,
        "mobile": phone,
        "imgUniCode": captcha_data["imgUniCode"],
        "imgAuthCode": img_auth_code.strip(),
        "sms_type": sms_type,
    })
    data, raw = _sign_and_post(
        "smsSend", payload,
        encrypt_keys=["login_name", "mobile", "imgUniCode", "imgAuthCode"],
    )
    return data if data is not None else raw

def login_by_sms(phone, auth_code):
    payload = _base_payload()
    payload.update({"login_name": phone, "auth_code": auth_code.strip()})
    data, raw = _sign_and_post("smsLogin", payload, encrypt_keys=["login_name", "auth_code"])
    return data if data is not None else raw

def login_by_password(captcha_data, phone, password, img_auth_code):
    payload = _base_payload()
    payload.update({
        "login_name": phone,
        "pwd": hashlib.md5(password.encode("utf-8")).hexdigest(),
        "imgUniCode": captcha_data["imgUniCode"],
        "imgAuthCode": img_auth_code.strip(),
    })
    data, raw = _sign_and_post(
        "login", payload,
        encrypt_keys=["login_name", "pwd", "imgUniCode", "imgAuthCode"],
    )
    return data if data is not None else raw

def query_user_info(login_name, ses_id):
    payload = {
        "channel": CHANNEL,
        "app_ver_no": APP_VER_NO,
        "timestamp": str(int(time.time() * 1000)),
        "login_name": login_name,
        "ses_id": ses_id,
    }
    try:
        data, _ = _sign_and_post("query", payload, encrypt_keys=["login_name"])
        return data
    except Exception as e:
        print("[-] 查询失败：", e)
        return None

# ================= 结果输出 =================
def print_credentials(result):
    login_name = result.get("login_name") or result.get("user_id") or ""
    ses_id = result.get("ses_id") or ""
    if not login_name or not ses_id:
        print("[-] 登录响应里没有找到 login_name / ses_id：")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return False
    print("\n" + "🎉" * 20)
    print("登录成功！把下面两个填进面板「环境变量」：\n")
    print("  HZGH_LOGIN_NAME = %s" % login_name)
    print("  HZGH_SES_ID     = %s" % ses_id)
    print("\n（ses_id 会过期，签到开始失败时重跑本工具即可）")
    print("🎉" * 20 + "\n")
    return True

# ================= 流程 =================
def flow_sms():
    phone = input("请输入登录手机号: ").strip()
    if not phone:
        print("[-] 手机号不能为空")
        return
    captcha = get_captcha()
    if not captcha:
        return
    show_captcha(captcha)
    img_code = input("[?] 看图后输入「图形验证码」: ").strip()
    sms_res = send_sms(captcha, phone, img_code)
    if not (sms_res and sms_res.get("result") == "0"):
        print("[-] 短信发送失败：", (sms_res or {}).get("msg", sms_res))
        return
    print("[+] 短信已发送，请查收手机短信")
    sms_code = input("[?] 输入「手机收到的短信验证码」: ").strip()
    result = login_by_sms(phone, sms_code)
    if result and result.get("result") == "0":
        print_credentials(result)
    else:
        print("[-] 登录失败：", (result or {}).get("msg", result))

def flow_password():
    phone = input("请输入登录手机号: ").strip()
    password = input("请输入登录密码: ").strip()
    if not phone or not password:
        print("[-] 手机号和密码都要填")
        return
    captcha = get_captcha()
    if not captcha:
        return
    show_captcha(captcha)
    img_code = input("[?] 看图后输入「图形验证码」: ").strip()
    result = login_by_password(captcha, phone, password, img_code)
    if result and result.get("result") == "0":
        print_credentials(result)
    else:
        print("[-] 登录失败：", (result or {}).get("msg", result))

def flow_check():
    login_name = os.environ.get("HZGH_LOGIN_NAME", "").strip()
    ses_id = os.environ.get("HZGH_SES_ID", "").strip()
    if not login_name or not ses_id:
        print("[-] 环境变量 HZGH_LOGIN_NAME / HZGH_SES_ID 未设置，无法校验")
        return
    print("正在用 U005 校验 ses_id 是否仍有效 ...")
    info = query_user_info(login_name, ses_id)
    if info and info.get("result") == "0":
        name = info.get("name") or info.get("sensitive_name") or "(未知)"
        integral = info.get("remain_integral") or info.get("total_integral") or "?"
        print("[+] ses_id 有效 ✅  用户：%s  积分：%s" % (name, integral))
    else:
        print("[-] ses_id 可能已失效 ❌，请重新登录取码：python hzgh_login.py")
        if info:
            print("    服务器返回：", info.get("msg", info))

def main():
    parser = argparse.ArgumentParser(description="杭工e家 登录取码工具")
    parser.add_argument("--check", action="store_true", help="校验现有环境变量里的 ses_id 是否有效")
    parser.add_argument("--password", action="store_true", help="用密码登录（默认短信登录）")
    args = parser.parse_args()

    print("=" * 50)
    print("  杭工e家 · 登录取码工具")
    print("=" * 50)

    if args.check:
        flow_check()
        return

    if args.password:
        flow_password()
    else:
        flow_sms()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已取消。")
