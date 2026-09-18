#!/usr/bin/env node
/**
 * 构建期 CSS 生成器：把上游样式表全部作用域化到 #darkroom-root 之下，
 * 再拼上本插件自身的样式，输出插件的 styles.css。
 *
 * 为什么必须作用域化：
 *   上游样式大量使用 id 选择器（#wrapper、#content、#main、#stores、#village…）
 *   和通用选择器（body、html、::selection、.button、.tooltip、.menu、.star），
 *   直接注入会污染整个 Obsidian 界面；反过来 Obsidian 主题也会改坏游戏。
 *
 * 四类需要特殊处理的规则：
 *   1. body / html（含 body.noMask 这种组合）—— 它们指的就是根容器本身，不能加后代空格；
 *   2. ::selection / ::-moz-selection —— 无主体选择器，必须作为后代选择器接在前缀之后；
 *   3. @keyframes —— 动画名是全局的，须加 darkroom- 前缀，并同步改写 animation 引用；
 *   4. dark.css（上游的夜间模式）—— 另用一个前缀 #darkroom-root.darkenLights，
 *      运行时由 runtime/engine-overrides.js 在根容器上切换 darkenLights 类来控制启停。
 *
 * 用法：node scripts/scope-css.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const UPSTREAM = path.join(ROOT, "src", "game", "upstream");
const STYLES = path.join(ROOT, "src", "styles");
const PREFIX = "#darkroom-root";
const DARK_PREFIX = "#darkroom-root.darkenLights";

/** 按 index.html 的 <link> 顺序排列 —— 顺序自检比对的就是这一组。 */
const LINKED_SHEETS = [
  "css/main.css",
  "css/room.css",
  "css/outside.css",
  "css/path.css",
  "css/world.css",
  "css/ship.css",
  "css/space.css",
  "css/fabricator.css",
];

/** 上游不通过 <link> 加载（由内联脚本 document.write 注入），但必须并入的样式表。 */
const EXTRA_SHEETS = ["lang/zh_cn/main.css"];

const SHEETS = [...LINKED_SHEETS, ...EXTRA_SHEETS];

/** 不在 index.html 里 —— 上游由 JS 在切换夜间模式时动态插入，这里静态并入。 */
const DARK_SHEET = "css/dark.css";

const readUpstream = (rel) => fs.readFileSync(path.join(UPSTREAM, rel), "utf8");

// ─────────────────────────────────────────────────────────────────────
// 一、顺序自检
// ─────────────────────────────────────────────────────────────────────

function assertSheetOrder() {
  const html = readUpstream("index.html");

  // 先剥掉所有不带 src 的内联 <script> 块，再扫 href。原因：其中一段内联脚本用
  //   document.write('<link rel="stylesheet" type="text/css" href="lang/'+lang+'/main.css" />')
  // 动态注入语言样式；直接扫 href 会把 "lang/" 这个残缺字符串误当成一张样式表。
  const withoutInline = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, "");
  const fromHtml = [...withoutInline.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/g)].map((m) => m[1]);

  if (fromHtml.join("|") !== LINKED_SHEETS.join("|")) {
    throw new Error(
      `[scope-css] 样式表顺序与上游 index.html 不一致。\n` +
        `   index.html: ${fromHtml.join(", ")}\n` +
        `   本文件:     ${LINKED_SHEETS.join(", ")}\n` +
        `请更新 LINKED_SHEETS，使其与上游保持一致。`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// 二、最小 CSS 解析
// ─────────────────────────────────────────────────────────────────────

/** 把一段 CSS 切成顶层块（普通规则以 } 收尾，@ 规则整体成块，注释原样保留）。 */
function splitTopLevel(css) {
  const blocks = [];
  let depth = 0;
  let buf = "";
  let inComment = false;

  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    const next = css[i + 1];

    if (inComment) {
      buf += c;
      if (c === "*" && next === "/") {
        buf += next;
        i++;
        inComment = false;
        // 顶层注释必须单独成块。否则它会和紧随其后的选择器粘在同一个 prelude 里，
        // 被 prefixSelectorList 当作选择器的一部分，产出
        //   "#darkroom-root /* Fonts */ body, …"
        // 这种规则 —— 注释被剥离后等价于 "#darkroom-root body"，永远匹配不到任何元素。
        if (depth === 0) {
          if (buf.trim()) blocks.push(buf.trim());
          buf = "";
        }
      }
      continue;
    }
    if (c === "/" && next === "*") {
      buf += c + next;
      i++;
      inComment = true;
      continue;
    }

    if (c === "{") depth++;
    else if (c === "}") depth--;

    buf += c;

    if (depth === 0 && (c === "}" || c === ";")) {
      if (buf.trim()) blocks.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) blocks.push(buf.trim());
  return blocks;
}

/** 给单个选择器加前缀。 */
function prefixSelector(selector, prefix) {
  const sel = selector.trim();
  if (!sel) return sel;

  // body / html（可能带类或属性，如 body.noMask）—— 指的就是根容器本身。
  if (/^(body|html)\b/i.test(sel)) {
    const rest = sel.replace(/^(body|html)\b/i, "").trim();
    return prefix + rest;
  }

  // 其余一律作为后代选择器。
  // `::selection` 这类无主体选择器同样适用（前缀 + 空格 + 伪元素）。
  return `${prefix} ${sel}`;
}

/** 给选择器列表（逗号分隔）加前缀。 */
function prefixSelectorList(list, prefix) {
  return list
    .split(",")
    .map((s) => prefixSelector(s, prefix))
    .join(", ");
}

/** @keyframes 名是全局的，加前缀并同步改写 animation 引用。 */
function scopeKeyframes(css) {
  const nameRe = /@(?:-webkit-|-moz-|-ms-|-o-)?keyframes\s+([\w-]+)/g;
  const names = new Set();
  for (const m of css.matchAll(nameRe)) names.add(m[1]);
  if (names.size === 0) return css;

  let out = css.replace(nameRe, (m, name) => m.replace(name, `${"darkroom-"}${name}`));

  out = out.replace(/((?:-\w+-)?animation(?:-name)?\s*:\s*)([^;}]*)/g, (m, head, value) => {
    let v = value;
    for (const n of names) {
      v = v.replace(new RegExp(`(^|[\\s,])${n}(?=[\\s,]|$)`, "g"), `$1darkroom-${n}`);
    }
    return head + v;
  });

  return out;
}

/** 对整段 CSS 做作用域化。 */
function scopeCss(css, prefix) {
  const blocks = splitTopLevel(css);
  const out = [];

  for (const block of blocks) {
    const braceAt = block.indexOf("{");

    // 无块的语句（@import、@charset…）—— 原样保留。
    if (braceAt === -1) {
      out.push(block);
      continue;
    }

    const prelude = block.slice(0, braceAt).trim();
    const body = block.slice(braceAt + 1, block.lastIndexOf("}"));

    // @keyframes：内部是 0% / from / to 之类的帧，不做选择器前缀，只重命名。
    if (/^@(?:-\w+-)?keyframes\b/.test(prelude)) {
      out.push(block);
      continue;
    }

    // 其它 @ 规则（@media、@supports…）：递归处理内部。
    if (prelude.startsWith("@")) {
      out.push(`${prelude} {\n${scopeCss(body, prefix)}\n}`);
      continue;
    }

    out.push(`${prefixSelectorList(prelude, prefix)} {${body}}`);
  }

  return out.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────
// 三、产出
// ─────────────────────────────────────────────────────────────────────

const BANNER = `/*
 * 自动生成，请勿手工编辑 —— 生成器：scripts/scope-css.mjs
 *
 * 本文件包含 A Dark Room 的样式表，采用 Mozilla Public License 2.0，
 * 版权归 Michael Townsend / Doublespeak Games 所有。
 *   上游仓库：https://github.com/doublespeakgames/adarkroom
 *   许可全文：LICENSE-ADARKROOM.md
 *   来源与改动：THIRD_PARTY_NOTICES.md
 *
 * 上游全部选择器都已在构建期被加上 #darkroom-root 前缀（夜间模式用
 * #darkroom-root.darkenLights），因此不会泄漏到 Obsidian 界面。
 */`;

function build() {
  assertSheetOrder();

  const parts = [BANNER];

  for (const rel of SHEETS) {
    const scoped = scopeKeyframes(scopeCss(readUpstream(rel), PREFIX));
    parts.push(`/* ============ upstream ${rel} ============ */\n${scoped}`);
  }

  const dark = scopeKeyframes(scopeCss(readUpstream(DARK_SHEET), DARK_PREFIX));
  parts.push(`/* ============ upstream ${DARK_SHEET}（夜间模式，由根容器上的 darkenLights 类控制）============ */\n${dark}`);

  parts.push(
    `/* ============ 本插件自身的样式（MIT）============ */\n${fs.readFileSync(path.join(STYLES, "plugin.css"), "utf8").trim()}`
  );

  const out = parts.join("\n\n");
  fs.writeFileSync(path.join(ROOT, "styles.css"), out, "utf8");

  const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(1);
  console.log(`[scope-css] 已生成 styles.css（${kb} KB，共 ${SHEETS.length + 1} 张上游样式表 + 插件样式）`);
}

build();
