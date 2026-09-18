#!/usr/bin/env node
/**
 * 构建期代码生成器：把上游 A Dark Room 拼装成隔离作用域的 ESM 运行时。
 *
 *   输入  src/game/upstream/**    上游源码（原样，不得修改）
 *         src/game/runtime/**     本插件的平台适配代码
 *   输出  src/game/generated/adr.runtime.js
 *         src/game/generated/adr.runtime.d.ts
 *
 * 为什么是"拼接"而不是逐文件 import：
 *   上游脚本是裸全局脚本风格 —— 顶层 `var Foo = {...}`，各文件通过全局作用域互相引用
 *   （room.js 用 `$SM`、`Engine`，事件文件用 `Events`、`AudioLibrary`…）。
 *   若把每个文件当 ESM 逐个 import，每个文件会各自获得独立的模块作用域，
 *   顶层 var 不再互通，游戏立刻崩。包进单个 IIFE 既保住互通性，
 *   又把这些符号收进作用域内，不污染 Obsidian 的 window。
 *
 * 对本文件的**所有**上游改动都集中在 TRANSFORMS 里，且每条都必须命中：
 * 未命中就直接报错退出。这是刻意的 —— 否则上游代码一旦变化，转换会静默失效，
 * 把 `window` 污染、整页跳转之类的问题悄悄放回 Obsidian。
 * 改动清单同时登记在 src/game/upstream.meta.json 的 buildTimeTransforms。
 *
 * 用法：node scripts/build-game.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const UPSTREAM = path.join(ROOT, "src", "game", "upstream");
const RUNTIME = path.join(ROOT, "src", "game", "runtime");
const GENERATED = path.join(ROOT, "src", "game", "generated");
/** 上游提交 SHA 由 src/game/upstream/COMMIT 记录 —— 与源码放在一起作为来源凭证。 */
const COMMIT = fs.readFileSync(path.join(UPSTREAM, "COMMIT"), "utf8").trim().split(/\r?\n/)[0].trim();

const readUpstream = (rel) => fs.readFileSync(path.join(UPSTREAM, rel), "utf8");
const readRuntime = (rel) => fs.readFileSync(path.join(RUNTIME, rel), "utf8");

// ─────────────────────────────────────────────────────────────────────
// 一、对上游源码的构建期变换
// ─────────────────────────────────────────────────────────────────────

/** 全局规则：`$('body')` 与 `appendTo('body')` 这类写法都会落到 Obsidian 自身的 body 上。
 *
 * 前者是键盘绑定与太空过场背景色；后者更隐蔽 —— engine.js:120 的
 * `$('<div>').addClass('menu').appendTo('body')` 把**主菜单**（重启 / 熄灯 / 分享 /
 * 存档 / github …）整个建在 Obsidian 的 body 里：既跑出了根容器，又失去
 * #darkroom-root 前缀的样式，于是那些按钮一个都看不见。
 * space.js 还有三处同样写法（#starsContainer 与两处太空过场元素）。
 * 注意 'body' 作为方法参数时躲得过 `$('body')` 那条正则，必须单独替换。 */
const retargetBody = {
  id: "redirect-body-selectors",
  global: true,
  expect: /\$\s*\(\s*['"]body['"]\s*\)|appendTo\s*\(\s*['"]body['"]\s*\)/,
  apply: (src) =>
    src
      .replace(/\$\s*\(\s*['"]body['"]\s*\)/g, "$(__darkroomRoot)")
      .replace(/\b(appendTo|prependTo)\s*\(\s*['"]body['"]\s*\)/g, "$1(__darkroomRoot)"),
};

/** 全局规则：`document.title = x` 会改掉整个 Obsidian 窗口的标题。 */
const retargetTitle = {
  id: "retarget-document-title",
  global: true,
  expect: /document\.title/,
  apply: (src) =>
    src
      // 关键：必须把整条赋值语句（含结尾分号）一起换成函数调用。
      // 只替换等号左边会产出 `__darkroomHost.setTitle(x;` —— 缺右括号，直接是语法错误。
      .replace(/document\.title\s*=\s*([^;]+);/g, "__darkroomHost.setTitle($1);")
      // 剩下的就是读取形式，例如 events.js 的 `var title = document.title;`。
      .replace(/document\.title\b/g, "__darkroomHost.getTitle()"),
};

const TRANSFORMS = [
  {
    id: "scope-i18n-helper",
    file: "lib/translate.js",
    expect: /window\._ = translate;/,
    apply: (src) => src.replace(/window\._ = translate;/, "/* [darkroom] was: window._ = translate; */ _ = translate;"),
  },
  {
    id: "hoist-engine-off-window",
    file: "script/engine.js",
    expect: /var Engine = window\.Engine = \{/,
    // 注意：engine.js（连同它的 `var Engine = window.Engine = {…}`）整体包在自己的 IIFE 里。
    // 所以不能只把 window.Engine 抹掉 —— 那样 Engine 仍旧只是那个内层函数的局部变量，
    // 拼接作用域里的 engine-overrides.js 就会报 "Engine is not defined"。
    // 改为纯赋值，并在 PRELUDE 预先声明 var Engine，让它落到外层作用域上。
    apply: (src) => src.replace(/var Engine = window\.Engine = \{/, "Engine = {"),
  },
  {
    id: "remove-location-redirects",
    file: "script/engine.js",
    expect: /window\.location = 'browserWarning\.html';/,
    apply: (src) =>
      src
        .replace(/window\.location = 'browserWarning\.html';/, "/* [darkroom] removed: window.location = browserWarning.html */")
        .replace(/window\.location = 'mobileWarning\.html';/, "/* [darkroom] removed: window.location = mobileWarning.html */"),
  },
  {
    id: "scope-state-off-window",
    file: "script/engine.js",
    expect: /window\.State = this\.options\.state;/,
    apply: (src) =>
      src
        .replace(/window\.State = this\.options\.state;/, "State = this.options.state;")
        .replace(/window\.State = \{\};/, "State = {};"),
  },
  {
    id: "scope-selection-guards",
    file: "script/engine.js",
    expect: /document\.onselectstart = eventNullifier;/,
    apply: (src) =>
      src
        .replace(/document\.onselectstart = eventNullifier;/g, "__darkroomRoot.onselectstart = eventNullifier;")
        .replace(/document\.onmousedown = eventNullifier;/g, "__darkroomRoot.onmousedown = eventNullifier;")
        .replace(/document\.onselectstart = eventPassthrough;/g, "__darkroomRoot.onselectstart = eventPassthrough;")
        .replace(/document\.onmousedown = eventPassthrough;/g, "__darkroomRoot.onmousedown = eventPassthrough;"),
  },
  {
    id: "disable-autoboot",
    file: "script/engine.js",
    expect: /\$\(function\(\) \{\s*Engine\.init\(\);\s*\}\);/,
    apply: (src) => src.replace(/\$\(function\(\) \{\s*Engine\.init\(\);\s*\}\);/, "/* [darkroom] removed autoboot —— 改由适配层显式调用 boot() */"),
  },
  {
    id: "drop-menu-entries",
    file: "script/engine.js",
    expect: /_\(\s*['"]share\.['"]\s*\)/,
    // 主菜单里这三项对本移植没有意义，整块删掉：
    //   应用商店 —— 引导去下载手机 App；
    //   分享     —— 外链社交分享；
    //   夜间模式 —— 改为跟随 Obsidian 的深/浅色设置，不再由游戏内手动切换。
    // 每一项的形状都是 `$('<span>') … .appendTo(menu);`，故按块匹配，
    // 再用块内的文案判断是否属于要删的三项（非贪婪，不会吃到相邻块）。
    apply: (src) =>
      src.replace(
        /\$\(\s*['"]<span>['"]\s*\)[\s\S]*?\.appendTo\(\s*menu\s*\);\s*/g,
        (block) =>
          /_\(\s*['"](get the app|lights off|share)\.?['"]\s*\)/.test(block) ? "" : block
      ),
  },
  {
    id: "remove-audio-prompt",
    file: "script/engine.js",
    expect: /setTimeout\(notifyAboutSound, 3000\);/,
    apply: (src) => src.replace(/setTimeout\(notifyAboutSound, 3000\);/, "/* [darkroom] removed: notifyAboutSound —— 静音版无需提示开启音效 */"),
  },
  retargetBody,
  retargetTitle,
];

const appliedTransforms = new Set();

function transform(rel, src) {
  let out = src;
  for (const rule of TRANSFORMS) {
    if (!rule.global && rule.file !== rel) continue;
    const hit = rule.expect.test(out);
    if (!hit) {
      if (rule.global) continue;
      throw new Error(
        `[build-game] 变换 "${rule.id}" 未能在 ${rel} 命中。\n` +
          `上游代码很可能已变化 —— 请复核 src/game/upstream.meta.json 的 buildTimeTransforms 后同步本文件。`
      );
    }
    out = rule.apply(out);
    appliedTransforms.add(rule.id);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 二、拼装顺序
// ─────────────────────────────────────────────────────────────────────

/**
 * 顺序取自上游 index.html 的 <script> 标签（下面的 assertOrderMatchesIndexHtml 会强制校验）。
 * 两处例外：
 *   - lang/zh_cn/strings.js 在上游由 index.html 里的 document.write 动态注入，
 *     这里改为静态插入到 translate.js 之后。
 *   - script/audio.js 不随包分发，其位置由 runtime/audio-stub.js 顶替。
 */
const MODULES = [
  { runtime: "host.js" },
  { runtime: "storage-shim.js" },

  { file: "lib/jquery.min.js", wrap: "jquery" },
  { file: "lib/jquery.color-2.1.2.min.js" },
  { file: "lib/jquery.event.move.js" },
  { file: "lib/jquery.event.swipe.js" },
  { file: "lib/base64.js" },
  { file: "lib/translate.js" },
  { file: "lang/zh_cn/strings.js" },

  { file: "script/Button.js" },
  { file: "script/audioLibrary.js" },
  { runtime: "audio-stub.js" },
  { file: "script/engine.js" },
  { runtime: "engine-overrides.js" },
  { file: "script/state_manager.js" },
  { file: "script/header.js" },
  { file: "script/notifications.js" },
  { file: "script/events.js" },
  { file: "script/room.js" },
  { file: "script/outside.js" },
  { file: "script/world.js" },
  { file: "script/path.js" },
  { file: "script/ship.js" },
  { file: "script/space.js" },
  { file: "script/fabricator.js" },
  { file: "script/prestige.js" },
  { file: "script/scoring.js" },
  { file: "script/events/global.js" },
  { file: "script/events/room.js" },
  { file: "script/events/outside.js" },
  { file: "script/events/encounters.js" },
  { file: "script/events/setpieces.js" },
  { file: "script/events/marketing.js" },
  { file: "script/events/executioner.js" },
];

/** 上游存在、但本移植刻意不引入的脚本。 */
const NOT_VENDORED = ["lang/langs.js", "script/audio.js", "script/localization.js"];

/**
 * 上游由内联脚本动态加载、因而不会出现在 <script src> 列表里的文件：
 *   - lib/jquery.min.js      —— 上游优先从 Google CDN 取 jQuery，仅当 window.jQuery 不存在时
 *                               才用 document.write 回退加载本地这份；
 *   - lang/zh_cn/strings.js  —— 语言包由内联脚本按 ?lang= / localStorage.lang 动态注入。
 * 两者都必须随包分发（我们不放 CDN、也不要动态注入），故只从顺序校验中豁免。
 */
const DYNAMICALLY_LOADED = ["lib/jquery.min.js", "lang/zh_cn/strings.js"];

/** 自检：我们的顺序必须与 index.html 的实际加载顺序一致。 */
function assertOrderMatchesIndexHtml() {
  const html = readUpstream("index.html");
  // 先剥掉所有**不带 src** 的内联 <script> 块，再提取 src。原因：index.html 里有一段内联脚本
  // 用 document.write('<script src="lang/'+lang+'/strings.js"><\/script>') 动态注入语言包，
  // 直接正则扫 src 会把这行字符串当成一个真实的脚本标签，从而误判为顺序不一致。
  const withoutInline = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, "");
  const fromHtml = [...withoutInline.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((src) => !/^(https?:)?\/\//.test(src)) // 去掉 Google CDN 的 jQuery
    .filter((src) => !NOT_VENDORED.includes(src));

  const fromModules = MODULES.filter((m) => m.file && !DYNAMICALLY_LOADED.includes(m.file)).map((m) => m.file);

  if (fromHtml.join("|") !== fromModules.join("|")) {
    throw new Error(
      `[build-game] 拼装顺序与上游 index.html 不一致。\n` +
        `  index.html: ${fromHtml.join(", ")}\n` +
        `  本文件:     ${fromModules.join(", ")}\n` +
        `请更新 MODULES，使加载顺序与上游保持一致。`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// 三、拼装
// ─────────────────────────────────────────────────────────────────────

const BANNER = `/*
 * 自动生成，请勿手工编辑 —— 生成器：scripts/build-game.mjs
 *
 * 本文件包含 A Dark Room 的上游源码，采用 Mozilla Public License 2.0，
 * 版权归 Michael Townsend / Doublespeak Games 所有。
 *   上游仓库：https://github.com/doublespeakgames/adarkroom
 *   固定提交：${COMMIT}
 *   许可全文：LICENSE-ADARKROOM.md
 *   来源与改动：THIRD_PARTY_NOTICES.md
 *   逐条改动登记：src/game/upstream.meta.json 的 buildTimeTransforms
 *
 * 上游各文件被拼接进同一 IIFE 作用域，其顶层 var 因此不会泄漏到 Obsidian 的 window。
 */`;

const PRELUDE = `export default function createDarkroomRuntime() {
"use strict";

/* 本文件导出的是一个**工厂**而非单例：每次调用都得到一套全新的、彼此隔离的游戏实例
 * （各自的 jQuery、State（$SM）、计时器与事件订阅）。
 * 视图重建、存档导入都能因此直接推倒重来，不必去打扫上一局的残留状态 ——
 * 尤其是那串自续的 setTimeout 链，靠 dispose() 一次性清干净。 */

/* 上游原本依赖 index.html 或"隐式全局"的符号，必须在严格模式生效前显式声明。
 * 严格模式下给未声明变量赋值会直接抛 ReferenceError，而拼接产物带 ESM 语义即严格模式。
 *
 * 这份名单不是拍脑袋列的 —— 它来自 tsc 对完整拼接产物跑 checkJs 得到的 Cannot find name
 * （命令与结果见 THIRD_PARTY_NOTICES.md 第 4 条）：
 *   State    —— 上游从未用 var 声明它（靠隐式全局），严格模式下直接赋值会抛错；
 *   _        —— 由 lib/translate.js 赋值（原本挂 window._）；
 *   Engine   —— engine.js 整体在自己的 IIFE 内，它那里的 Engine = {…} 需要落在这个外层作用域上，
 *               否则紧随其后的 engine-overrides.js 会报 "Engine is not defined"；
 *   oldIE    —— index.html 里的 var oldIE = false，engine.js 的 browserValid() 会读；
 *   Enemies  —— script/events/executioner.js 第 1 行写作 Enemies = window.Enemies ?? {}，
 *               而 events 模块全程以 Enemies.Executioner.* 引用它。缺失时的表现就是
 *               「一打开视图即报 Enemies is not defined」；
 *   swipeElement —— engine.js 的 Engine.init() 里直接赋值（swipe 手势绑定），boot 阶段就会执行；
 *   elem     —— notifications.js 的 Notify 里直接赋值，游戏一开始就会用到；
 *   craftable / good —— room.js、fabricator.js 的事件处理函数之间跨作用域引用；
 *   c2 / c3  —— setpieces.js 剧情节点里跨作用域引用；
 *   define / ga / langs —— 上游以 typeof 守卫探测的可选全局（AMD / Google Analytics / 语言表）。
 *               预声明后 typeof 仍为 undefined，行为完全不变，只是不再算未声明。 */
var State;
var _;
var Engine;
var oldIE = false;
var Enemies;
var swipeElement;
var elem;
var craftable;
var good;
var c2;
var c3;
var define;
var ga;
var langs;
`;

const EPILOGUE = `
/* ============ 对外句柄 ============ */
return {
  setHost: __setHost,
  setRoot: __setRoot,

  /** 启动游戏。宿主须先完成 setRoot / setHost，并保证 DOM 骨架已就位。 */
  boot: function (options) {
    Engine.init(options || {});
    return Engine;
  },

  Engine: Engine,
  $SM: $SM,
  $: $,

  modules: {
    Room: Room,
    Outside: Outside,
    World: World,
    Path: Path,
    Events: Events,
    Notifications: Notifications,
    Header: Header,
    Button: Button,
    Prestige: Prestige,
    Score: Score,
    Ship: Ship,
    Space: Space,
    Fabricator: Fabricator,
    AudioLibrary: AudioLibrary
  },

  /** 当前存档状态对象（上游的隐式全局 State，此处经闭包取用）。 */
  getState: function () {
    return typeof State === "undefined" ? null : State;
  },

  /** 立即落盘当前存档。 */
  save: function () {
    Engine.saveGame();
  },

  /** 停止本实例的一切计时活动。此后该实例不可再用，应整体丢弃。 */
  dispose: __dispose
};
}
`;

const TYPES = `/*
 * 自动生成，请勿手工编辑 —— 生成器：scripts/build-game.mjs
 * 内含 A Dark Room（MPL-2.0，© Michael Townsend / Doublespeak Games）。
 */
export interface DarkroomHost {
  /** 同步读取全部持久化键值；返回 undefined 表示尚无存档。 */
  load(): Record<string, string> | undefined;
  /** 持久化当前的键值快照（实现方应自行节流）。 */
  save(state: Record<string, string>): void;
  /** 清空持久化数据。 */
  clear(): void;
  /** 游戏想把标题设为 title（上游会写 document.title）。 */
  setTitle(title: string): void;
  /** 读取上一个标题。 */
  getTitle(): string;
  /** 游戏的里程碑埋点（Engine.event(cat, act)）。 */
  gameEvent(cat: string, act: string): void;
  /** 游戏导入了一份新存档并已写入存储桥，宿主应据此重建运行时。 */
  importSave(saveData: string): void;
}

export interface DarkroomRuntime {
  setHost(host: Partial<DarkroomHost>): void;
  setRoot(el: HTMLElement): void;
  boot(options?: Record<string, unknown>): unknown;
  /** 立即落盘当前存档。 */
  save(): void;
  /** 停止本实例的一切计时活动；此后该实例不可再用。 */
  dispose(): void;
  Engine: any;
  $SM: any;
  $: any;
  modules: Record<string, any>;
  getState(): unknown;
}

/** 工厂：每次调用都得到一套全新的、彼此隔离的游戏实例。 */
export default function createDarkroomRuntime(): DarkroomRuntime;
`;

function build() {
  assertOrderMatchesIndexHtml();

  const chunks = [];
  for (const mod of MODULES) {
    if (mod.runtime) {
      chunks.push(`/* ================= runtime/${mod.runtime} ================= */\n${readRuntime(mod.runtime).trimEnd()}`);
      continue;
    }

    const src = transform(mod.file, readUpstream(mod.file));

    if (mod.wrap === "jquery") {
      // jQuery 1.10.1 的 UMD 尾部是：
      //   "object"==typeof module && module && "object"==typeof module.exports
      //     ? module.exports = x
      //     : (e.jQuery = e.$ = x, ...)
      // 提供本地 module 即可让它走前者，从而在不触碰 window 的前提下取回实例。
      chunks.push(`/* ================= ${mod.file} =================
 * 以 CommonJS 形态取回：不向 window 注入 $ / jQuery。 */
var $ = (function () {
  var module = { exports: {} };
  var exports = module.exports;
${src}
  return module.exports;
})();
var jQuery = $;`);
    } else {
      chunks.push(`/* ================= ${mod.file} ================= */\n${src.trimEnd()}`);
    }
  }

  // 各段之间用 "\n;\n" 而不是空行连接：上游文件原本靠换行 + ASI 分隔，拼接起来之后，
  // 若上一段以 } 或 ) 结尾、下一段以 ( 或 [ 开头，ASI 不会替我们插入分号 ——
  // 于是 "}\n(function(){…})()" 会被解析成"把对象当函数调用"，抛
  // "{…} is not a function"。（base64.js 正是以 `var Base64 = {…}` 结尾且无分号，
  // 紧随其后的就是 translate.js 的 IIFE。）补一个分号即可彻底规避这类问题。
  const out = `${BANNER}\n${PRELUDE}\n${chunks.join("\n;\n")}\n${EPILOGUE}`;

  fs.mkdirSync(GENERATED, { recursive: true });
  fs.writeFileSync(path.join(GENERATED, "adr.runtime.js"), out, "utf8");
  fs.writeFileSync(path.join(GENERATED, "adr.runtime.d.ts"), TYPES, "utf8");

  const missing = TRANSFORMS.filter((r) => !r.global && !appliedTransforms.has(r.id)).map((r) => r.id);
  if (missing.length) {
    throw new Error(`[build-game] 以下变换未生效：${missing.join(", ")}`);
  }

  const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(1);
  console.log(`[build-game] 已生成 src/game/generated/adr.runtime.js（${kb} KB，共 ${MODULES.length} 个模块）`);
  console.log(`[build-game] 生效的上游变换：${[...appliedTransforms].join(", ")}`);
}

build();
