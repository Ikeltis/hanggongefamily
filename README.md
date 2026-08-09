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
`hzgh_login.py` 是**手动运行**的取码工具，**不能作为面板任务运行**（原因见「三点五、登录取码」）。

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

### 可选（通知，配了哪个就推哪个）
`BARK_PUSH`、`TG_BOT_TOKEN`+`TG_USER_ID`、`PUSH_KEY`(Server酱)、`PUSH_PLUS_TOKEN`、
`QYWX_KEY`(企业微信机器人)、`DD_BOT_TOKEN`(+`DD_BOT_SECRET`)、`FSKEY`(飞书)。

> 📣 **这些一个都不配也能推**：`sendNotify.js` 会自动改用**面板自己的通知渠道**
> （呆呆面板「通知设置」里配好的 Telegram/Bark/… 直接复用），不必把 token 再抄一份
> 到环境变量里。原理是委托给面板托管的 `sendNotify.js`（scripts 根目录那个，
> 由面板注入 `DAIDAI_NOTIFY_URL`/`DAIDAI_NOTIFY_TOKEN`，走 `POST /api/notifications`）。
>
> 优先级：环境变量渠道 > 面板托管渠道 > 仅打印日志。
> 青龙等没有托管助手的环境会自动跳过这一层，行为与以前一致。

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
登录要人工看图形验证码、输手机短信码，中途有**两次交互输入**。

### ⚠️ 不能在面板里点「运行」

面板的任务执行器不给脚本分配 stdin，`input()` 会立刻读到 EOF：

```
请输入登录手机号: Traceback (most recent call last):
  ...
  File "hzgh_login.py", line 269, in flow_sms
    phone = input("请输入登录手机号: ").strip()
EOFError: EOF when reading a line
=== 退出码 1 ===
```

所以**必须用 `docker exec -it` 进容器跑**，才有真正的交互终端。

```bash
# 呆呆面板（容器名 daidai-panel）
docker exec -it daidai-panel \
  /app/Dumb-Panel/deps/python/3.12/bin/python3 \
  /app/Dumb-Panel/scripts/Ikeltis_hanggongefamily/hzgh_login.py

# 青龙（容器名 qinglong）
docker exec -it qinglong python3 /ql/data/scripts/Ikeltis_hanggongefamily/hzgh_login.py
```

> 💡 **注意 Python 解释器的选择**：面板「依赖管理」里 pip 装的包不在容器的系统
> Python 里。呆呆面板装到独立 venv（形如 `/app/Dumb-Panel/deps/python/<版本>/`），
> 直接用容器的 `python3` 会报 `ModuleNotFoundError: No module named 'requests'`。
> 用 `docker exec <容器> ls /app/Dumb-Panel/deps/python/` 确认实际版本号。

其他用法（同样要 `docker exec -it`，下面省略前缀）：

```bash
# 密码登录
python hzgh_login.py --password

# 校验环境变量里现有 ses_id 是否还有效
python hzgh_login.py --check
```

`--check` 是唯一无交互的用法，可以不带 `-it`，方便脚本化检查：

```bash
docker exec -e HZGH_LOGIN_NAME='...' -e HZGH_SES_ID='...' daidai-panel \
  /app/Dumb-Panel/deps/python/3.12/bin/python3 \
  /app/Dumb-Panel/scripts/Ikeltis_hanggongefamily/hzgh_login.py --check
```

流程（短信登录）：

1. 输入手机号 → 工具打印一行 `data:image/jpeg;base64,...`
2. **把这一整行粘到浏览器地址栏回车**，就能看到图形验证码（终端里看不了图片文件，故用 data URL）
3. 输入图形验证码 → 手机收到短信 → 输入短信验证码
4. 成功后工具直接打印 `HZGH_LOGIN_NAME` 和 `HZGH_SES_ID`，复制到面板「环境变量」即可
5. 以后 `ses_id` 失效（签到开始报错），重跑一次本工具、更新 `HZGH_SES_ID` 即可

> 💡 图形验证码**填错不会白发短信**——服务端先校验图形码，错了直接返回失败，
> 重新跑一遍即可，不消耗短信次数。

> 📌 第 2 步的 data URL 以前是跨几十行的（服务端返回的 base64 自带 MIME 换行），
> 「复制一整行」根本做不到，粘过去只有半张破图。现已在 `show_captcha()` 里把
> base64 压成真正的一行，照上面做即可。

> ⚠️ **不要把 `hzgh_login.py` 放进订阅白名单。** 放白名单会被面板自动建成任务，
> 而且默认给排 `0 0 * * *`（README 旧版让你「把定时留空/禁用」，但面板并不会留空），
> 结果就是每天零点准时失败一次。正确做法是放进**依赖段**——文件照样落盘可供
> `docker exec` 使用，但不会生成任务。详见第五节。

---

## 四、定时（cron）建议

面板用标准 5 段 cron，按面板时区。

| 脚本 | 仓库里声明的 cron | 说明 |
|------|------------------|------|
| `hzgh_signin.js` | `19 9 * * *` | 每天上午 9:19 签到。避开整点，减少和别人撞在一起的概率 |
| `hzgh_exchange.js` | **不声明** | 开抢时刻取决于当期活动，没有通用值，请自己在面板里设 |

**抢券怎么设**：把 cron 排在开抢时刻**前 1~2 分钟**，脚本内部会自旋等待到点。
例如 12:00 开抢 → cron 设 `58 11 * * *`，并设 `HZGH_EXCHANGE_TIME=12:00:00`。

### 关于脚本头部的 `cron:` 声明

订阅自动建任务时，面板/青龙会读脚本头部的 `cron:` 行来决定定时。格式要求严格：

```js
/*
cron: 19 9 * * *
*/
```

必须是**行首**、**ASCII 冒号**。写成「cron 建议：每天早上执行」这类中文说明是**解析不到**的
（本仓库之前就是这样，结果三个任务全被塞了默认值 `0 0 * * *`，其中取码工具还因此每晚
定时失败一次）。

> ⚠️ 没有 `cron:` 声明的脚本（比如 `hzgh_exchange.js`）建任务时会拿到默认的
> `0 0 * * *`，**记得进面板清空或改成你要的时间**。
>
> 另外，改了脚本头部的 cron 后，对**已存在**的任务不会自动生效 —— 面板只在
> 首次建任务时读它。已有任务请直接在面板里改，或删掉任务后重跑订阅重建。

---

## 五、用订阅方式拉取（可选）

本项目已发布在 `https://github.com/Ikeltis/hanggongefamily`（私有仓库）。
可在面板「订阅」中按青龙 `ql repo` 约定拉取。**白名单只放两个真正的定时任务**，
`hzgh_login.py` 和库文件一起走依赖段：

```
ql repo https://github.com/Ikeltis/hanggongefamily.git "hzgh_signin|hzgh_exchange" "" "hzgh_lib_|sendNotify|hzgh_login" "main"
```

> 私有仓库拉取需在面板配置带凭据的地址，例如
> `https://<用户名>:<token>@github.com/Ikeltis/hanggongefamily.git`。

- 白名单（第 2 段）：`hzgh_signin|hzgh_exchange` → 自动建任务，设 cron 自动跑
- 依赖规则（第 4 段）：`hzgh_lib_|sendNotify|hzgh_login` → 拉取落盘，**不建任务**
  - 依赖段的文件同样会出现在脚本目录里，`docker exec` 能正常访问 —— 取码工具放这里，
    既拿得到文件，又不会多出一个每天失败的幽灵任务
- 改了订阅规则或仓库有新提交后，要在「订阅」里**重新运行一次**才会同步到面板

> 🔁 **从旧配置迁移**：如果你之前按旧 README 把 `hzgh_login` 放在白名单里，面板已经
> 给它建了一个 cron 为 `0 0 * * *` 的任务。改订阅规则**不会**自动删掉它
> （多数面板 `auto_del_task` 默认关闭），需要你到「任务管理」里**手动删除**
> 那个 `hzgh_login` 任务，否则它会继续每晚失败一次。

也可以直接在面板脚本编辑器里手动新建/上传这些文件（`hzgh_signin.js` / `hzgh_exchange.js` /
`hzgh_lib_*.js` / `sendNotify.js` / `hzgh_login.py`），然后配置环境变量与 cron；
登录工具保持手动运行即可。

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
