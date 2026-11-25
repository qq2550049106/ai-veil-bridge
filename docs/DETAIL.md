# AI-Veil 桥插件 · 详情

## 它解决什么问题

DeepSeek Harness 里，Agent 帮你点鼠标、敲键盘、截图、开应用的时候，**用户没有任何"我正在被操作"的信号**。
这个插件把 Agent 的动作翻译成 AI-Veil 的统一事件，桌面端就会弹出系统级横幅/边框、播提示音、发桌面通知，
并且给用户一条独立的中止通道。

## 装了什么

| 文件 | 作用 |
| --- | --- |
| `index.mjs` | 原生插件模块：导出 `apply(ctx)`，注册 `veil_emit` / `veil_cancel` 两个工具，事件追加到 `~/.ai-veil/events.jsonl` |
| `cordis.patch.yml` | bundle 挂载层，把 `ai-veil-bridge` 插入 profile 插件树（不含任何本机绝对路径） |
| `package.json` | 声明 `dsh.bundle.patch`、`engines.dsh`、`repository`、许可证等元信息 |
| `locale/{zh,en}.json` | 插件面板里的标题与描述 |
| `demo/emit-demo.mjs` | 一键演示脚本：不接任何 Agent 也能灌一整段接管流程 |
| `scripts/self-check.mjs` | 无宿主自检，验证工具注册与"无本机绝对路径" |

## 两个工具

- `veil_emit` —— 上报事件。开始接管、每次动作前后、需要人工介入、出错、结束都该调用；
  长任务每 25 秒发一次 `heartbeat` 续期（插件也内置了自动心跳，避免遗忘续期时遮罩静默消失）。
- `veil_cancel` —— 请求中止。会写 `~/.ai-veil/cancel/cancel-*.json`，并让桌面端立即收起遮罩。

## 桌面端怎么跑（Electron 版）

```bash
cd ai-veil
npm install
npm start -- --adapter file        # 消费 ~/.ai-veil/events.jsonl
```

## 演示（不需要接任何 Agent）

```bash
# 终端 A：桌面端
npm start -- --adapter file
# 终端 B：灌一段演示事件（约 10 秒）
node demo/emit-demo.mjs
# 想从头回放已经攒下的事件：
#   AI_VEIL_INBOX_FROM_START=1 npm start -- --adapter file
```

## 事件格式

`veil_emit` 的 `event` 是一个 VeilEvent 对象，核心字段：

| 字段 | 说明 |
| --- | --- |
| `event` | `session.start` / `action.before` / `action.after` / `need_human` / `heartbeat` / `session.end` |
| `ts` | 毫秒时间戳（缺省插件补当前时间） |
| `session_id` | 会话 id（缺省插件补一个本次进程内的 id） |
| `agent` | `{ name, version }` |
| `mode` | 一般 `takeover` |
| `scope` | 影响范围：`fullscreen` / `window` / `region`（带 bounds） |
| `action` | `{ type, target }`，type 如 `click` / `type` / `screenshot` / `launch` / `other` |
| `visual` | 可选，覆盖边框颜色、动画、横幅形状 |

插件会用 `normalize` 补齐 `ts` / `session_id` / `agent` / `mode` / `cancel`，保证桌面端解析不因缺字段丢事件。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_VEIL_INBOX` | `~/.ai-veil/events.jsonl` | 事件落盘路径（插件与桌面端都要一致） |
| `AI_VEIL_AGENT` | `deepseek-harness` | 事件里 `agent.name` 的默认值 |
| `AI_VEIL_INBOX_FROM_START` | 空 | 桌面端侧：`1` 表示从文件头开始回放 |

## 边界与排错

- **单向**：插件能上报、能留中止记录，但真正"掐断 Agent 进程"要宿主自己配合。
- **桌面端没启动也不会错**：事件只是安静排队，DSH 侧不会报错、不阻塞。
- **看不到任何东西**：先确认桌面端在跑（`npm start -- --adapter file`），再看 `~/.ai-veil/logs/ai-veil.log` 有没有对应事件。
- **不占端口、不联网**：只写本地文件，没有任何网络调用。

## 与旧版（MCP 桥）的区别

早期版本用一个 stdio MCP 子进程（`bridge.mjs` + 写死 node 绝对路径）转发事件。现在改为**原生插件**：
直接在宿主进程里注册工具，不再外挂子进程，也彻底去掉了"换台机器就失效"的本机绝对路径。
