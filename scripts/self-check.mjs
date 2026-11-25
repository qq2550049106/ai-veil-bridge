#!/usr/bin/env node
// ai-veil-bridge/scripts/self-check.mjs —— 无宿主自检
//
// 用最小 fake ctx 加载插件，验证：
//   1. apply(ctx) 可被调用且注册了 veil_emit / veil_cancel 两个工具；
//   2. 工具定义带 name/description/parameters/output/execute；
//   3. veil_emit 真能往收件箱写一行合法 JSONL（写到 E 盘临时文件，不碰真实收件箱）；
//   4. 插件文件里没有任何本机绝对路径（可上架硬要求）；
//   5. package.json 清单字段达标（无 private、有 dsh.bundle.patch、有 repository）。
// 运行：node scripts/self-check.mjs   （退出码非 0 即失败）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

// 临时收件箱：放在插件目录内，运行后删除，不写系统盘
const tmpInbox = path.join(root, ".self-check-inbox.jsonl");
const tmpCancelDir = path.join(root, ".self-check-cancel");
process.env.AI_VEIL_INBOX = tmpInbox;
process.env.AI_VEIL_CANCEL_DIR = tmpCancelDir;

const { apply, inject, name: pluginName } = await import(pathToFileURL(path.join(root, "index.mjs")).href);

const registered = [];
const effects = [];
const ctx = {
  tools: {
    register(def) {
      registered.push(def);
      return () => {};
    },
  },
  effect(fn) {
    effects.push(fn);
  },
};

let failed = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failed++;
};

check(
  "模块导出 apply / inject(tools) / name",
  typeof apply === "function" && Array.isArray(inject) && inject.includes("tools") && pluginName === "ai-veil-bridge"
);

try {
  apply(ctx);
  check("apply(ctx) 未抛异常", true);
} catch (e) {
  check("apply(ctx) 未抛异常", false, String(e && e.message ? e.message : e));
}

check("注册了两个工具", registered.length === 2, `实际 ${registered.length}`);
const byName = Object.fromEntries(registered.map((d) => [d.name, d]));
for (const tool of ["veil_emit", "veil_cancel"]) {
  const def = byName[tool];
  check(
    `${tool} 定义完整（description/parameters/output/execute）`,
    !!def && !!def.description && !!def.parameters && !!def.output && typeof def.execute === "function"
  );
}

if (byName.veil_emit) {
  const res = await byName.veil_emit.execute({
    event: { event: "session.start", action: { type: "launch", target: "自检" } },
  });
  const line = fs.readFileSync(tmpInbox, "utf8").trim().split("\n").pop();
  const parsed = JSON.parse(line);
  check(
    "veil_emit 写入合法 JSONL",
    res.ok === true && parsed.event === "session.start" && typeof parsed.ts === "number" && !!parsed.session_id && !!parsed.agent
  );
}

if (byName.veil_cancel) {
  const res = await byName.veil_cancel.execute({ reason: "自检中止" });
  check("veil_cancel 返回中止记录", res.ok === true && !!res.cancelled);
}

// 可上架硬要求：包里不得出现本机绝对路径（用户目录/Program Files 等）
const scanFiles = [
  "index.mjs",
  "package.json",
  "cordis.patch.yml",
  "README.md",
  "docs/DETAIL.md",
  "demo/emit-demo.mjs",
  "screenshots.json",
  "locale/zh.json",
  "locale/en.json",
];
const absPattern = /(?:[A-Za-z]:[\\/](?:Users|Program Files|ProgramData)[\\/])|(?:["'\/]\/home\/|\/Users\/)/;
for (const rel of scanFiles) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    check(`文件存在：${rel}`, false);
    continue;
  }
  const text = fs.readFileSync(p, "utf8");
  check(`无本机绝对路径：${rel}`, !absPattern.test(text));
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
check("package.json 未标 private", !pkg.private);
check("package.json 声明 dsh.bundle.patch", !!pkg.dsh && !!pkg.dsh.bundle && pkg.dsh.bundle.patch === "./cordis.patch.yml");
check("package.json repository 指向插件仓库", !!pkg.repository && /github\.com\/qq2550049106\/ai-veil-bridge/.test(pkg.repository.url));
check("package.json engines.dsh 存在", !!pkg.engines && !!pkg.engines.dsh);

// 卡片位图与 SVG 图标就位
check("icon.svg 存在", fs.existsSync(path.join(root, "icon.svg")));
check("assets/icon-180.png 存在（市场卡片位图）", fs.existsSync(path.join(root, "assets", "icon-180.png")));
const shots = JSON.parse(fs.readFileSync(path.join(root, "screenshots.json"), "utf8"));
check(
  "screenshots.json 的图片都存在",
  Array.isArray(shots) && shots.length >= 1 && shots.every((s) => fs.existsSync(path.join(root, s)))
);

for (const fn of effects) {
  const cleanup = fn();
  if (typeof cleanup === "function") cleanup();
}
fs.rmSync(tmpInbox, { force: true });
fs.rmSync(tmpCancelDir, { recursive: true, force: true });

console.log(failed === 0 ? "\nSELF-CHECK OK" : `\nSELF-CHECK FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
