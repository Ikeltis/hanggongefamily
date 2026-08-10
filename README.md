# 杭工e家 · 呆呆面板/青龙脚本（hanggongefamily）

把 [AutoTicket](https://github.com/BAOfanTing/AutoTicket) 的 JS 逻辑改造成适配
[呆呆面板 daidai-panel](https://github.com/linzixuanzz/daidai-panel)（类青龙）的定时任务脚本。
单账号版本。

> ⚠️ 本项目基于 API 逆向，仅供学习研究。请遵守当地法律法规及杭工e家 App 的用户协议，风险自负。

---

## 一、文件说明

| 文件 | 类型 | 说明 |
|------|------|------|
| `hzgh_signin.js` | **任务** | 每日签到：登录签到 → N 次日常签到 → 评论 → 查询积分，结果汇总一条通知 |
| `hzgh_exchange.js` | **任务** | 定时抢券：等到目标时刻（可校准服务器时间）后开抢，带最大时长/次数上限 |
| `hzgh_lib_config.js` | 库 | 从环境变量读取全部配置 |
| `hzgh_lib_encrypt.js` | 库 | RSA + 3DES 请求加密/签名（逆向所得，未改动） |
| `hzgh_lib_decrypt.js` | 库 | 响应 `data2` 解密（兼容不同 Node 版本，见第七节 CVE 说明） |
| `hzgh_lib_http.js` | 库 | HTTP 请求 + 服务器时间校准 |
| `sendNotify.js` | 库 | 多通道推送（Bark/TG/Server酱/PushPlus/企业微信/钉钉/飞书） |
| `hzgh_login.py` | **手动工具** | 短信/密码登录取码，拿到 `login_name`/`ses_id`；也能校验现有 ses_id 是否有效（Python） |
| `requirements.txt` | 依赖 | `hzgh_login.py` 的 pip 依赖（requests、pycryptodome） |

「任务」文件会被面板识别为定时任务，其余 `hzgh_lib_*` / `sendNotify.js` 是共享库。
`hzgh_login.py` 是**手动运行**的取码工具，**不能作为面板任务运行**（原因见「四、登录取码」）。

---

## 二、必填 & 可选环境变量

在面板「环境变量」里添加（**不要**用 `export xxx=""`）。

### 必填
| 变量 | 说明 |
|------|------|
| `HZGH_LOGIN_NAME` | 登录名 `login_name`（从一次成功登录中获取的用户名令牌） |
| `HZGH_SES_ID` | 会话 ID `ses_id` |

> 获取方式：见第四节「登录取码」，用本项目的 `hzgh_login.py` 登录即可。
> `ses_id` 会过期，过期后签到/抢券会失败，需要重新获取更新。

### 可选（签到）
| 变量 | 默认 | 说明 |
|------|------|------|
| `HZGH_SIGNIN_TIMES` | `3` | 日常签到次数 |
| `HZGH_SIGNIN_GAP_MS` | `1000` | 每次签到间隔(ms) |
| `HZGH_COMMENT` | `好` | 评论内容 |
| `HZGH_COMMENT_RELATED_ID` | `1232` | 评论目标 id |
| `HZGH_APP_VER` | `3.1.7` | App 版本号 |

### 可选（抢券）
| 变量 | 默认 | 说明 |
|------|------|------|
| `HZGH_EXCHANGE_ID` | `10` | 券类型：`9`=2元, `10`=4元, `11`=6元 |
| `HZGH_EXCHANGE_TIME` | 空 | 目标开抢时刻 `HH:MM:SS`（面板时区）。留空=立即开抢 |
| `HZGH_EXCHANGE_CALIBRATE` | `1` | 是否用服务器 `Date` 头校准时钟，`0` 关闭 |
| `HZGH_EXCHANGE_LEAD_MS` | `150` | 提前多少毫秒发第一枪（补偿加密+网络耗时） |
| `HZGH_EXCHANGE_INTERVAL_MS` | `100` | 每次尝试间隔(ms) |
| `HZGH_EXCHANGE_MAX_MS` | `15000` | 最长持续时长(ms)，到点即停 |
| `HZGH_EXCHANGE_MAX_ATTEMPTS` | `200` | 最大尝试次数 |

### 可选（通知）
默认直接复用面板「通知设置」里配好的渠道，不用配。想单独指定推送通道时，
可用环境变量覆盖，变量名见 `sendNotify.js` 头部。

---

## 三、依赖安装

只依赖一个包 `node-rsa`。在面板「依赖管理」里安装 Node 依赖 `node-rsa`，
或在脚本目录执行：

```bash
npm install
```

`hzgh_login.py`（取码工具）另需 Python 依赖，在面板「依赖管理」按 pip 安装
`requests` 和 `pycryptodome`，或：

```bash
pip install -r requirements.txt
```

---

## 四、登录取码（获取 / 校验 ses_id）

签到与抢券任务不含登录逻辑，需要你先登录拿到 `login_name` 与 `ses_id` 填进环境变量。

### 不能在面板里点「运行」

登录中途要输图形验证码和短信验证码，而面板的任务执行器不给脚本分配 stdin，
`input()` 会立刻读到 EOF：

```
请输入登录手机号: Traceback (most recent call last):
  ...
EOFError: EOF when reading a line
=== 退出码 1 ===
```

必须用 `docker exec -it` 进容器跑，才有交互终端：

```bash
# 呆呆面板（容器名 daidai-panel）
docker exec -it daidai-panel \
  /app/Dumb-Panel/deps/python/3.12/bin/python3 \
  /app/Dumb-Panel/scripts/Ikeltis_hanggongefamily/hzgh_login.py

# 青龙（容器名 qinglong）
docker exec -it qinglong python3 /ql/data/scripts/Ikeltis_hanggongefamily/hzgh_login.py
```

> 💡 **别用容器自带的 `python3`**：面板「依赖管理」里 pip 装的包在独立 venv 里
> （呆呆面板形如 `/app/Dumb-Panel/deps/python/<版本>/`），用系统 `python3` 会报
> `ModuleNotFoundError: No module named 'requests'`。版本号用
> `docker exec <容器> ls /app/Dumb-Panel/deps/python/` 确认。

### 短信登录流程

1. 输入手机号 → 工具打印一行 `data:image/jpeg;base64,...`
2. **把这一整行粘到浏览器地址栏回车**，就能看到图形验证码（终端里显示不了图片，故用 data URL）
3. 输入图形验证码 → 手机收到短信 → 输入短信验证码
4. 成功后工具直接打印 `HZGH_LOGIN_NAME` 和 `HZGH_SES_ID`，复制到面板「环境变量」即可
5. 以后 `ses_id` 失效（签到开始报错），重跑一次本工具、更新 `HZGH_SES_ID` 即可

### 另外两种用法

在上面那条 `docker exec -it` 命令末尾加参数即可：

- `--password` 用密码登录（仍要输图形验证码）
- `--check` 校验现有 `ses_id` 是否还有效

`--check` 是唯一无交互的用法，可以去掉 `-it`，方便脚本化检查：

```bash
docker exec -e HZGH_LOGIN_NAME='...' -e HZGH_SES_ID='...' daidai-panel \
  /app/Dumb-Panel/deps/python/3.12/bin/python3 \
  /app/Dumb-Panel/scripts/Ikeltis_hanggongefamily/hzgh_login.py --check
```

---

## 五、定时（cron）建议

面板用标准 5 段 cron，按面板时区。

| 脚本 | 仓库里声明的 cron | 说明 |
|------|------------------|------|
| `hzgh_signin.js` | `19 9 * * *` | 每天上午 9:19 签到。避开整点，减少和别人撞在一起的概率 |
| `hzgh_exchange.js` | **不声明** | 开抢时刻取决于当期活动，没有通用值，请自己在面板里设 |

**抢券怎么设**：把 cron 排在开抢时刻**前 1~2 分钟**，脚本内部会自旋等待到点。
例如 12:00 开抢 → cron 设 `58 11 * * *`，并设 `HZGH_EXCHANGE_TIME=12:00:00`。

---

## 六、用订阅方式拉取（可选）

```
ql repo https://github.com/Ikeltis/hanggongefamily.git "hzgh_signin|hzgh_exchange" "" "hzgh_lib_|sendNotify|hzgh_login" "main"
```

注意 `hzgh_login` 在依赖段而不是白名单 —— 它是手动运行的取码工具（见第四节），
放白名单会被建成定时任务，然后每次触发都失败。

---

## 七、安全须知（务必了解）

1. **关闭了 TLS 校验**（`rejectUnauthorized:false`，沿用原项目以兼容目标服务器）。
   在不可信网络下你的凭据可能被中间人截获，尽量只在可信环境运行。
2. **凭据以明文形式存于面板环境变量**，请勿把 `HZGH_LOGIN_NAME`/`HZGH_SES_ID` 泄露或提交到公共仓库。
3. **`data2` 解密用的是 PKCS#1 v1.5**。Node 18.19 / 20.11 / 22 默认因 CVE-2023-46809 禁用它，
   脚本会自动回退到 `node --security-revert=CVE-2023-46809` 子进程解密；
   更新的 Node（如 26）默认放开该限制、直接进程内解密。三种策略脚本会自动探测并缓存，无需你干预。
