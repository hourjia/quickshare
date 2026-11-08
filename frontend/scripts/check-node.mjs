#!/usr/bin/env node
/**
 * 校验构建/开发所使用的运行时版本。
 *
 * 约定值来自仓库根目录 AGENTS.md，并与 .nvmrc、.node-version、package.json 的
 * engines / volta、frontend/deploy/Dockerfile 的镜像标签保持一致。
 *
 * 规则：
 *   - Node 大版本不符 → 直接失败（跨大版本构建结果不可复现）。
 *   - Node 次版本/补丁不符 → 警告后继续（本地开发友好）。
 *   - 设置 STRICT_NODE=1（CI、发布流程）时，任何版本差异都视为失败。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE = "24.22.2";
const REQUIRED_PNPM = "11.1.2";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readExpectedNode() {
  try {
    return readFileSync(join(root, ".nvmrc"), "utf8").trim() || REQUIRED_NODE;
  } catch {
    return REQUIRED_NODE;
  }
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function equal(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function detectPnpm() {
  const match = /pnpm\/(\d+\.\d+\.\d+)/.exec(process.env.npm_config_user_agent ?? "");
  return match ? match[1] : null;
}

const strict = process.env.STRICT_NODE === "1";
const expectedNode = readExpectedNode();
const actualNode = parseVersion(process.versions.node);
const wantedNode = parseVersion(expectedNode);
const actualPnpm = detectPnpm();
const wantedPnpm = parseVersion(REQUIRED_PNPM);

if (!actualNode || !wantedNode) {
  process.stderr.write(
    `无法解析 Node 版本（当前 ${process.versions.node}，期望 ${expectedNode}）。\n`,
  );
  process.exit(1);
}

if (actualNode[0] !== wantedNode[0]) {
  process.stderr.write(
    `Node 大版本不符：当前 ${process.versions.node}，约定 ${expectedNode}。\n` +
      "请用 nvm / fnm / volta 切换到 .nvmrc 指定的版本后重试。\n",
  );
  process.exit(1);
}

const warnings = [];
if (!equal(actualNode, wantedNode)) {
  warnings.push(`Node 当前 ${process.versions.node}，约定 ${expectedNode}`);
}
if (actualPnpm && wantedPnpm && !equal(parseVersion(actualPnpm), wantedPnpm)) {
  warnings.push(`pnpm 当前 ${actualPnpm}，约定 ${REQUIRED_PNPM}`);
}

if (warnings.length > 0) {
  if (strict) {
    process.stderr.write(
      `运行时版本与约定不一致（STRICT_NODE=1）：\n  - ${warnings.join("\n  - ")}\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`[警告] 运行时版本与约定不一致，构建结果可能与发布产物有差异：\n  - ${warnings.join("\n  - ")}\n`);
}

process.stdout.write(
  `运行时校验通过：Node ${process.versions.node}` +
    (actualPnpm ? `，pnpm ${actualPnpm}` : "") +
    "\n",
);
