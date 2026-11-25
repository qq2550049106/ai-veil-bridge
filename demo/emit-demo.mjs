#!/usr/bin/env node
// ai-veil-bridge/demo/emit-demo.mjs —— 一键演示：往 AI-Veil 的事件收件箱灌一整段"接管"流程
//
// 用法：
//   node demo/emit-demo.mjs            # 正常速度（每步 ~1.4s）
//   node demo/emit-demo.mjs --speed=2  # 2 倍速
//   node demo/emit-demo.mjs --loop     # 周而复始
//
// 配合桌面端：
//   npm start -- --adapter file        # 从文件末尾增量消费
//   AI_VEIL_INBOX_FROM_START=1 npm start -- --adapter file   # 从头回放
//
// 它做的事和 DSH 会话里的 veil_emit 完全一样：往 ~/.ai-veil/events.jsonl 追加 JSONL。
// 没有桌面端在跑时也不会报错——事件只是排队等消费。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const speedArg = process.argv.find((a) => a.startsWith("--speed="));
const speed = speedArg ? Math.max(0.1, Number(speedArg.split("=")[1]) || 1) : 1;
const loop = args.has("--loop");
const quiet = args.has("--quiet");

const INBOX = process.env.AI_VEIL_INBOX || path.join(os.homedir(), ".ai-veil", "events.jsonl");
const AGENT = { name: "deepseek-harness", version: "0.1.0" };
const SESSION = `demo-${Date.now().toString(36)}`;

fs.mkdirSync(path.dirname(INBOX), { recursive: true });
if (!fs.existsSync(INBOX)) fs.writeFileSync(INBOX, "", "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 每一步：事件 + 相对上一步的等待时间 */
const STEPS = [
  [
    0,
    {
      event: "session.start",
      mode: "takeover",
      scope: { type: "fullscreen", display_id: 1 },
      action: { type: "launch", target: "打开 VS Code" },
      ttl_ms: 30000,
      cancel: { enabled: true, hotkey: "Ctrl+Alt+Esc" },
    },
  ],
  [1400, { event: "action.before", scope: { type: "window", bounds: { x: 0, y: 40, w: 1600, h: 900 }, display_id: 1 }, action: { type: "click", target: "资源管理器 · src/main.rs" } }],
  [1400, { event: "action.after", action: { type: "type", target: "已写入 42 行 Rust 代码" } }],
  [1400, { event: "heartbeat" }],
  [1200, { event: "action.before", scope: { type: "region", bounds: { x: 320, y: 180, w: 900, h: 520 }, display_id: 1 }, action: { type: "screenshot", target: "截取编辑器区域做视觉比对" } }],
  [
    1600,
    {
      event: "need_human",
      scope: { type: "fullscreen", display_id: 1 },
      action: { type: "other", target: "需要你确认：要覆盖 config.toml 吗？" },
      visual: { border: { color: "#FF3B30", animation: "pulse", width: 6 }, banner: { shape: "speech_bubble" } },
    },
  ],
  [2600, { event: "action.after", action: { type: "click", target: "点击「保存」" } }],
  [1400, { event: "session.end", action: { type: "other", target: "任务完成" } }],
];

function emit(payload) {
  const event = Object.assign(
    { ts: Date.now(), session_id: SESSION, agent: AGENT, mode: "takeover" },
    payload
  );
  fs.appendFileSync(INBOX, JSON.stringify(event) + "\n", "utf8");
  if (!quiet) {
    const label = payload.event.padEnd(14);
    const target = payload.action && payload.action.target ? " · " + payload.action.target : "";
    console.log(`  → ${label}${target}`);
  }
}

async function runOnce() {
  if (!quiet) console.log(`\n[ai-veil demo] session=${SESSION} inbox=${INBOX} speed=${speed}x\n`);
  for (const [wait, payload] of STEPS) {
    await sleep(wait / speed);
    emit(payload);
  }
  if (!quiet) console.log("\n演示结束。若桌面端在运行，此时遮罩应已淡出。\n");
}

process.on("SIGINT", () => {
  if (!quiet) console.log("\n已中断。");
  process.exit(0);
});

for (;;) {
  await runOnce();
  if (!loop) break;
  await sleep(2000 / speed);
  if (!quiet) console.log("[ai-veil demo] 循环重放…");
}
