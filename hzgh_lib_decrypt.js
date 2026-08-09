#!/usr/bin/env node
/**
 * 响应解密模块（从 JavaScript_Version/decrypt.js 移植，解密逻辑未改动）
 *
 * 面板适配要点：
 *   data2 使用 RSA/ECB/PKCS1Padding(v1.5)。Node 18.19+/20.11+/21.6+ 默认
 *   因 CVE-2023-46809(Marvin) 禁用了 PKCS#1 v1.5 privateDecrypt。
 *   因此本文件在被 require 时导出 smartDecrypt()：
 *     1) 先尝试进程内解密（老版本 Node 直接成功）；
 *     2) 失败则回退：以 `node --security-revert=CVE-2023-46809 本文件` 子进程解密。
 *   当本文件被直接 `node` 运行时，从 stdin 读入响应 JSON、输出解密后的 JSON
 *   —— 这正是子进程回退所调用的入口。
 */

const crypto = require('crypto');
const { spawn } = require('child_process');

// RSA 私钥 (直接嵌入代码中)
const RSA_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIICdQIBADANBgkqhkiG9w0BAQEFAASCAl8wggJbAgEAAoGBAIOBMtf2AIYQlrNy/lVPHx4R/LKI+Vtk3bKmzID8vdVnh/4WA3lczqfejM10Xfy3sNe4l5EeQTvnDgUHbIFK8FyJRpvypAmS9oyW6uwGTjZEu5Y6hsSxiGAOG5ZOlH8vOSfuaAkZ+iUlqifPE3ZOmHkqGzmukg4wCRaPLx5ioq8zAgMBAAECgYAgLOVmx677HmXxBCrMbq57agU9HZx9SyGfS4Zv7Ob5pvo0Jei1sgpyMlabEmTIp50iOu0CubdWU8MvYdCfldlXQLW7cjk8N1NyGQLFd2fJ03a7gGWnwwEdPoNTpSHnB+mDL9l7MVjion5fLojzq9Pz1gMKL01I2TfZBDL4m6EbgQJBAMfgrMKtj7f40GA3qp/y/9/eBCAu8PbtFmtATLMQRf4tGhjvn349x1b6FZj8RiaRBSrq0Owjrdo5TUxgfS7dz3MCQQCobdWk2SQhRlqEHfFEro/8ab6gn3GhBDzzKvNjhKr2MO6JWqs+Vr+/P9uYpA+G+rv74uVIGWhjuNtI5+/69DFBAkAJOQS/tuJ6yrBSwD7PQpcr7UKjeYcE3cu7ByyC1q1kHRCnNedWG+Omz8NPW9Sg0vA6GrupKbxL5Xj7nTgpgXKhAkBIVlvioAvfaqrngUClAd//RZ9EtxYDVKGkwnaj8E/Iyr04KsPPU0ypJBD5XsT4cOmZxho5PAhUhAlSJ6MvAf/BAkA64ieVhtQA1KV0pSSEJMnbPlZe+yBYGTWLMaG2zL0kKEhIs2fIHbVhLFQ8TkO5oH+mhxuuXI5+nVU2G0dqUl6D
-----END PRIVATE KEY-----`;

// 固定的 DESede 密钥前缀
const DESEDE_KEY_PREFIX = Buffer.from("HTt0Hzsu", 'utf-8');

// 从标准输入获取JSON响应
function getStdin() {
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.on('data', chunk => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', err => reject(err));
    });
}

// 解密 data2 字段（RSA 提取密钥材料 + DESede/CBC 解密数据）
function decryptData2(data2_full_base64) {
    if (data2_full_base64.length < 172) {
        throw new Error("data2 字符串长度不足 172，无法提取密钥材料。");
    }

    // --- 第一步：RSA 解密密钥材料 ---
    const rsa_encrypted_material_b64 = data2_full_base64.substring(0, 172);
    const rsa_encrypted_buffer = Buffer.from(rsa_encrypted_material_b64, 'base64');

    // RSA 解密 (PKCS #1 v1.5 填充，对应 Java "RSA/ECB/PKCS1Padding")
    const rsa_decrypted_buffer = crypto.privateDecrypt(
        {
            key: RSA_PRIVATE_KEY_PEM,
            padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        rsa_encrypted_buffer
    );
    const rsa_decrypted_str = rsa_decrypted_buffer.toString('utf-8');

    // --- 第二步：DESede 解密实际数据 ---
    const desede_encrypted_data_b64 = data2_full_base64.substring(172);

    // 生成 DESede 密钥 (K1K2K3 模式，取前 24 字节)："HTt0Hzsu" + str2
    const full_desede_key_buffer = Buffer.concat([
        DESEDE_KEY_PREFIX,
        Buffer.from(rsa_decrypted_str, 'utf-8')
    ]);
    const desede_key = full_desede_key_buffer.subarray(0, 24);
    if (desede_key.length !== 24) {
        throw new Error(`生成的 DESede 密钥长度 ${desede_key.length} 不足 24 字节。`);
    }

    // 生成 IV：str2.substring(0, 8)
    const iv_str = rsa_decrypted_str.substring(0, 8);
    const iv = Buffer.from(iv_str, 'utf-8');
    if (iv.length !== 8) {
        throw new Error(`生成的 IV 长度 ${iv.length} 不符合 8 字节要求。`);
    }

    const desede_encrypted_buffer = Buffer.from(desede_encrypted_data_b64, 'base64');

    // DESede/CBC/PKCS5Padding 解密
    const decipher = crypto.createDecipheriv('des-ede3-cbc', desede_key, iv);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(desede_encrypted_buffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf-8');
}

// 直接解密整个响应对象（把 data2 替换为解密后的明文字符串）
function decryptResponse(responseData) {
    if (!responseData || !responseData.data2) {
        throw new Error("响应中没有data2字段");
    }
    return { ...responseData, data2: decryptData2(responseData.data2) };
}

// 从 stdout 里提取第一段完整 JSON（用于过滤 SECURITY WARNING 之类的杂讯）
function extractJson(text) {
    const trimmed = (text || '').trim();
    try {
        return JSON.parse(trimmed);
    } catch (_) {
        // 逐行扫描，拼出第一段以 { 开头、} 结尾的 JSON
        const lines = trimmed.split('\n');
        let jsonContent = '';
        let inJson = false;
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('{')) { inJson = true; jsonContent = t; }
            else if (inJson) {
                jsonContent += ' ' + t;
                if (t.endsWith('}')) break;
            }
        }
        if (!jsonContent) throw new Error('未从解密输出中找到有效 JSON');
        return JSON.parse(jsonContent);
    }
}

// 以指定的额外 node 参数启动子进程解密。extraArgs=[] 表示不加任何 flag。
// 返回 { ok, result, code, stderr }：ok=true 时 result 为解密后的响应对象。
function decryptViaSubprocess(responseObj, extraArgs = []) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(process.execPath, [...extraArgs, __filename], { stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
            return resolve({ ok: false, code: -1, stderr: e.message });
        }
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d.toString(); });
        child.stderr.on('data', d => { stderr += d.toString(); });
        child.on('error', err => resolve({ ok: false, code: -1, stderr: err.message }));
        child.on('close', code => {
            if (code !== 0) return resolve({ ok: false, code, stderr: stderr.trim() });
            try {
                resolve({ ok: true, result: extractJson(stdout) });
            } catch (e) {
                resolve({ ok: false, code: 0, stderr: e.message });
            }
        });
        child.stdin.write(JSON.stringify(responseObj));
        child.stdin.end();
    });
}

// 记住本进程中「成功的解密策略」，避免每次都重复探测：
//   'inproc' 进程内 | 'none' 子进程不加 flag | 'flag' 子进程加 CVE 回退 flag
const CVE_FLAG = '--security-revert=CVE-2023-46809';
let cachedStrategy = null;

/**
 * 智能解密，兼容不同 Node 版本对 PKCS#1 v1.5(CVE-2023-46809) 的处理差异：
 *   1) 进程内解密（老 Node 或 Node 26+ 默认允许时直接成功）；
 *   2) 子进程不加 flag；
 *   3) 子进程加 --security-revert=CVE-2023-46809（Node 18.19~22 需要）。
 * 首次命中的策略会被缓存，后续调用直接复用。
 * @param {Object} responseObj  形如 { result, msg, data2, ... }
 * @returns {Promise<Object>}   解密后的响应对象（data2 为解密后的明文字符串）
 */
async function smartDecrypt(responseObj) {
    // 命中缓存策略
    if (cachedStrategy === 'inproc') return decryptResponse(responseObj);
    if (cachedStrategy === 'none' || cachedStrategy === 'flag') {
        const r = await decryptViaSubprocess(responseObj, cachedStrategy === 'flag' ? [CVE_FLAG] : []);
        if (r.ok) return r.result;
        cachedStrategy = null; // 缓存失效，回到探测
    }

    // 探测：进程内 → 子进程无 flag → 子进程带 flag
    let lastErr;
    try {
        const out = decryptResponse(responseObj);
        cachedStrategy = 'inproc';
        return out;
    } catch (e) { lastErr = e; }

    for (const [strategy, args] of [['none', []], ['flag', [CVE_FLAG]]]) {
        const r = await decryptViaSubprocess(responseObj, args);
        if (r.ok) { cachedStrategy = strategy; return r.result; }
        lastErr = new Error(`子进程解密失败(${strategy || 'none'}, code=${r.code}): ${r.stderr}`);
    }
    throw new Error(`解密失败，所有策略均未成功。最后错误：${lastErr && lastErr.message}`);
}

// 直接运行：作为子进程解密入口，从 stdin 读入、往 stdout 输出解密后的 JSON
if (require.main === module) {
    (async () => {
        let responseData;
        try {
            const responseText = (await getStdin()).trim();
            if (!responseText) {
                console.error("错误：未输入响应数据，解密终止。");
                process.exit(1);
            }
            responseData = JSON.parse(responseText);
            const decryptedResponse = decryptResponse(responseData);
            console.log(JSON.stringify(decryptedResponse));
        } catch (e) {
            console.error(`解密过程中发生错误: ${e.message}`);
            process.exit(1);
        }
    })();
}

module.exports = {
    decryptData2,
    decryptResponse,
    smartDecrypt,
};
