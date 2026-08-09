# 杭工e家 · 呆呆面板/青龙脚本（hanggongefamily）

把 [AutoTicket](https://github.com/BAOfanTing/AutoTicket) 的 JS 逻辑改造成适配
[呆呆面板 daidai-panel](https://github.com/linzixuanzz/daidai-panel)（类青龙）的定时任务脚本，
仿照 [smzdm_script](https://github.com/hex-ci/smzdm_script) 的组织方式：**配置走环境变量、通知走
`sendNotify.js`、库文件与任务文件分离**。单账号版本。

> ⚠️ 本项目基于 API 逆向，仅供学习研究。请遵守当地法律法规及杭工e家 App 的用户协议，风险自负。

---

## 一、文件说明

| 文件 | 类型 | 说明 |
|------|------|------|
| `hzgh_signin.js` | **任务** | 每日签到：登录签到 → N 次日常签到 → 评论 → 查询积分，结果汇总一条通知 |
| `hzgh_exchange.js` | **任务** | 定时抢券：等到目标时刻（可校准服务器时间）后开抢，带最大时长/次数上限 |
| `hzgh_lib_config.js` | 库 | 从环境变量读取全部配置 |
| `hzgh_lib_encrypt.js` | 库 | RSA + 3DES 请求加密/签名（逆向所得，未改动） |
| `hzgh_lib_decrypt.js` | 库 | 响应 `data2` 解密（兼容不同 Node 版本，见下文 CVE 说明） |
| `hzgh_lib_http.js` | 库 | HTTP 请求 + 服务器时间校准 |
| `sendNotify.js` | 库 | 多通道推送（Bark/TG/Server酱/PushPlus/企业微信/钉钉/飞书） |
| `hzgh_login.py` | **手动工具** | 短信/密码登录取码，拿到 `login_name`/`ses_id`；也能校验现有 ses_id 是否有效（Python） |
| `requirements.txt` | 依赖 | `hzgh_login.py` 的 pip 依赖（requests、pycryptodome） |

“任务”文件会被面板识别为定时任务，其余 `hzgh_lib_*` / `sendNotify.js` 是共享库。
`hzgh_login.py` 是**手动运行**的取码工具（不是定时任务，见第六节）。

---

## 二、必填 & 可选环境变量

在面板「环境变量」里添加（**不要**用 `export xxx=""`）。

### 必填
| 变量 | 说明 |
|------|------|
| `HZGH_LOGIN_NAME` | 登录名 `login_name`（从一次成功登录中获取的用户名令牌） |
| `HZGH_SES_ID` | 会话 ID `ses_id` |

> 获取方式：见下方「登录取码」一节，用面板自带的 `hzgh_login.py` 登录即可。
> `ses_id` 会过期，过期后签到/抢券会失败，需要重新获取更新。

### 可选（签到）
| 变量 | 默认 | 说明 |
|------|------|------|
| `HZGH_SIGNIN_TIMES` | `3` | 日常签到次数 |
| `HZGH_SIGNIN_GAP_MS` | `1000` | 每次签到间隔(ms) |
| `HZGH_COMMENT` | `好` | 评论内容 |
| `HZGH_COMMENT_RELATED_ID` | `1232` | 评论目标 id |
| `HZGH_APP_VER` | `3.1.4` | App 版本号 |

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

### 可选（通知，配了哪个就推哪个；都不配则只打印日志）
`BARK_PUSH`、`TG_BOT_TOKEN`+`TG_USER_ID`、`PUSH_KEY`(Server酱)、`PUSH_PLUS_TOKEN`、
`QYWX_KEY`(企业微信机器人)、`DD_BOT_TOKEN`(+`DD_BOT_SECRET`)、`FSKEY`(飞书)。

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

## 三点五、登录取码（获取 / 校验 ses_id）

签到与抢券任务不含登录逻辑，需要你先登录拿到 `login_name` 与 `ses_id` 填进环境变量。
**短信登录必须人工看图形验证码、输手机短信码，无法做成定时任务**，所以 `hzgh_login.py`
是**手动运行**的工具——在面板的「终端 / 命令行」里跑，不要配 cron。

```bash
# 短信验证码登录（默认）
python hzgh_login.py

# 密码登录
python hzgh_login.py --password

# 校验环境变量里现有 ses_id 是否还有效
python hzgh_login.py --check
```

流程（短信登录）：

1. 输入手机号 → 工具打印一行 `data:image/jpeg;base64,...`
2. **把这一整行粘到浏览器地址栏回车**，就能看到图形验证码（面板终端看不了图片文件，故用 data URL）
3. 输入图形验证码 → 手机收到短信 → 输入短信验证码
4. 成功后工具直接打印 `HZGH_LOGIN_NAME` 和 `HZGH_SES_ID`，复制到面板「环境变量」即可
5. 以后 `ses_id` 失效（签到开始报错），重跑一次本工具、更新 `HZGH_SES_ID` 即可

> ⚠️ `hzgh_login.py` 要能在面板里运行，就得先出现在**脚本列表**里。两种方式二选一：
> - **订阅**：把它放进 `ql repo` 的「依赖」段（第 4 段），拉取但**不自动建 cron**（见第五节）；
> - **手动**：在面板脚本编辑器里单独上传这一个文件。
>
> 无论哪种，都**不要给它设定时（cron）**——它是手动运行的取码工具，
> 若被建成了任务，请把该任务的定时关掉 / 禁用，只保留手动运行。

---

## 四、定时（cron）建议

面板里给两个任务分别设置 cron（面板用标准 5 段 cron，按面板时区）：

- **签到** `hzgh_signin.js`：每天一次即可，避开整点。例如
  ```
  8 8 * * *
  ```
- **抢券** `hzgh_exchange.js`：把 cron 排在开抢时刻**前 1~2 分钟**，脚本内部自旋等待到点。
  例如 12:00 开抢：cron 设 `58 11 * * *`，并设 `HZGH_EXCHANGE_TIME=12:00:00`。

---

## 五、用订阅方式拉取（可选）

本项目已发布在 `https://github.com/Ikeltis/hanggongefamily`（私有仓库）。
可在面板「订阅」中按青龙 `ql repo` 约定拉取，让 `hzgh_signin.js` / `hzgh_exchange.js`
自动成为任务，库文件与登录工具仅作依赖拉取（不建 cron）：

```
ql repo https://github.com/Ikeltis/hanggongefamily.git "hzgh_signin|hzgh_exchange" "" "hzgh_lib_|sendNotify|hzgh_login" "main"
```

> 私有仓库拉取需在面板配置带凭据的地址，例如
> `https://<用户名>:<token>@github.com/Ikeltis/hanggongefamily.git`。

- 白名单（第 2 段）：`hzgh_signin|hzgh_exchange` → 变成定时任务
- 依赖规则（第 4 段）：`hzgh_lib_|sendNotify|hzgh_login` → **拉取到脚本列表但不建 cron**
  - 其中 `hzgh_login`(取码工具)会出现在脚本列表里、可手动运行，但**不会**被排定时——正合所需
- 改了订阅规则或仓库有新提交后，要在「订阅」里**重新运行一次**才会同步到面板

也可以直接在面板脚本编辑器里手动新建/上传这些文件（7 个 JS/库 + `hzgh_login.py`），
然后配置环境变量与 cron；登录工具单独上传、保持手动运行即可。

---

## 六、安全须知（务必了解）

1. **关闭了 TLS 校验**（`rejectUnauthorized:false`，沿用原项目以兼容目标服务器）。
   在不可信网络下你的凭据可能被中间人截获，尽量只在可信环境运行。
2. **凭据以明文形式存于面板环境变量**，请勿把 `HZGH_LOGIN_NAME`/`HZGH_SES_ID` 泄露或提交到公共仓库。
3. **`data2` 解密用的是 PKCS#1 v1.5**。Node 18.19 / 20.11 / 22 默认因 CVE-2023-46809 禁用它，
   脚本会自动回退到 `node --security-revert=CVE-2023-46809` 子进程解密；
   更新的 Node（如 26）默认放开该限制、直接进程内解密。三种策略脚本会自动探测并缓存，无需你干预。

---

## 七、本地自测

```bash
# 语法检查
for f in hzgh_*.js sendNotify.js; do node --check "$f"; done

# 干跑签到（未配置凭据会给出明确报错；配置后可真实运行）
HZGH_LOGIN_NAME=你的login_name HZGH_SES_ID=你的ses_id node hzgh_signin.js
```
