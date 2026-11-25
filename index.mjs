// AI-Veil 接管提示器桥（原生 DSH 插件）
// ---------------------------------------------------------------------------
// 作用：把 Agent 的接管动作注册为模型可直接调用的两个工具，
//       事件按行追加到 AI-Veil 桌面端消费的文件收件箱。
//   veil_emit   —— 上报一条 VeilEvent（横幅/边框/提示音/桌面通知）
//   veil_cancel —— 请求中止当前接管会话
// 约束：
//   - 零运行时依赖：只用 node: 内置模块；宿主若提供 defineTool 则借用其校验，
//     否则按同形状的原始定义注册；
//   - 不引用任何本机绝对路径，事件收件箱默认 ~/.ai-veil/events.jsonl，
//     可用环境变量 AI_VEIL_INBOX 覆盖（与桌面端保持一致即可）；
//   - 插件卸载时，ctx.tools.register 与 ctx.effect 注册的定时器由框架自动清理。
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const name = "ai-veil-bridge";
export const inject = ["tools"];

const HOME = os.homedir();
const INBOX = process.env.AI_VEIL_INBOX || path.join(HOME, ".ai-veil", "events.jsonl");
const CANCEL_DIR = process.env.AI_VEIL_CANCEL_DIR || path.join(HOME, ".ai-veil", "cancel");
const AGENT_NAME = process.env.AI_VEIL_AGENT || "deepseek-harness";

let defineTool = null;
try {
  ({ defineTool } = await import("@deepseek-ai/dsh-tools"));
} catch {
  defineTool = null; // 宿主未暴露该包时，直接按原始定义对象注册
}

function ensureDirs() {
  fs.mkdirSync(path.dirname(INBOX), { recursive: true });
  fs.mkdirSync(CANCEL_DIR, { recursive: true });
}

function appendEvent(event) {
  ensureDirs();
  fs.appendFileSync(INBOX, JSON.stringify(event) + "\n", "utf8");
}

/** 补齐默认字段，保证 AI-Veil 侧解析不会因为缺字段而丢事件 */
function normalize(input, sessionId) {
  const event = { ...input };
  if (!event.event || typeof event.event !== "string" || !event.event.trim()) {
    throw new Error("缺少 event 字段");
  }
  event.event = event.event.trim();
  if (!event.ts || typeof event.ts !== "number") event.ts = Date.now();
  if (!event.session_id || typeof event.session_id !== "string") event.session_id = sessionId;
  if (!event.agent || typeof event.agent !== "object") {
    event.agent = { name: AGENT_NAME, version: "unknown" };
  }
  if (!event.mode) event.mode = "takeover";
  if (event.cancel === undefined) event.cancel = { enabled: true, hotkey: "Ctrl+Alt+Esc" };
  return event;
}

function extractEvent(args, sessionId) {
  if (args && typeof args === "object") {
    if (args.event && typeof args.event === "object") return normalize(args.event, sessionId);
    if (typeof args.event === "string") return normalize(JSON.parse(args.event), sessionId);
    if (typeof args.json === "string") return normalize(JSON.parse(args.json), sessionId);
    if (args.event === undefined && args.json === undefined) return normalize(args, sessionId);
  }
  throw new Error("veil_emit 需要 event 或 json 参数");
}

function cancelRequest(session, reason) {
  ensureDirs();
  const target = path.join(
    CANCEL_DIR,
    `cancel-${String(session).replace(/[^\w-]/g, "_")}-${Date.now()}.json`
  );
  fs.writeFileSync(
    target,
    JSON.stringify({ session_id: session, reason, ts: Date.now() }),
    "utf8"
  );
  appendEvent({
    event: "session.end",
    ts: Date.now(),
    session_id: session,
    agent: { name: AGENT_NAME, version: "unknown" },
    mode: "takeover",
    action: { type: "other", target: `已中止：${reason}` },
  });
  return target;
}

function register(ctx, definition) {
  return ctx.tools.register(defineTool ? defineTool(definition) : definition);
}

export function apply(ctx) {
  const startedAt = Date.now();
  const sessionId = `dsh-${startedAt.toString(36)}`;

  register(ctx, {
    name: "veil_emit",
    description:
      "向 AI-Veil 上报一条接管事件，让用户在屏幕上看到横幅/边框、听到提示音、收到桌面通知。开始接管、每次动作前后、需要人工介入、出错、结束都应调用；长任务每 25 秒发一次 heartbeat 续期。",
    parameters: {
      event: {
        type: "object",
        description:
          'VeilEvent 对象，例如 {"event":"action.before","action":{"type":"click","target":"保存按钮"}}',
      },
      json: {
        type: "string",
        description: "与 event 等价的 JSON 字符串（不方便传对象时使用）",
      },
    },
    output: {
      schema: { type: "object" },
      render: (_args, value) => [{ type: "text", text: value.summary }],
    },
    async execute(args) {
      const event = extractEvent(args, sessionId);
      appendEvent(event);
      return {
        ok: true,
        event: event.event,
        session_id: event.session_id,
        summary: `ok: ${event.event}`,
      };
    },
  });

  register(ctx, {
    name: "veil_cancel",
    description: "请求 AI-Veil 立即结束当前接管会话（等价于用户按下中止热键）。",
    parameters: {
      session_id: { type: "string", description: "要中止的会话 id，留空表示当前会话" },
      reason: { type: "string", description: "中止原因，会写入中止记录" },
    },
    output: {
      schema: { type: "object" },
      render: (_args, value) => [{ type: "text", text: value.summary }],
    },
    async execute(args) {
      const session = (args && args.session_id) || sessionId;
      const reason = (args && args.reason) || "Agent 请求中止";
      const target = cancelRequest(session, reason);
      return { ok: true, cancelled: target, summary: `cancelled: ${target}` };
    },
  });

  // 心跳续期：桌面端按 ttl 自动收起遮罩，这里周期性补一条 heartbeat，
  // 让长时间接管不因遗忘续期而静默失去提示。卸载时框架自动清理。
  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
        appendEvent({
          event: "heartbeat",
          ts: Date.now(),
          session_id: sessionId,
          agent: { name: AGENT_NAME, version: "unknown" },
          mode: "takeover",
        });
      } catch {
        /* 写失败不打断宿主 */
      }
    }, 25000);
    return () => clearInterval(timer);
  });
}
