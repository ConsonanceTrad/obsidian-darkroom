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

/**
 * 本项目（插件）自己的仓库地址。
 *
 * 游戏主菜单里那个 github 按钮原本指向 A Dark Room 自己的仓库；本移植是独立插件，
 * 那个按钮应当指向本项目 —— 与 manifest.json 的 author / authorUrl（ConsonanceTrad）一致。
 * 单点定义在此，供下面的 retarget-github-link 变换使用。
 */
const PROJECT_URL = "https://github.com/ConsonanceTrad/obsidian-darkroom";

const readUpstream = (rel) => fs.readFileSync(path.join(UPSTREAM, rel), "utf8");
const readRuntime = (rel) => fs.readFileSync(path.join(RUNTIME, rel), "utf8");

/**
 * 列出 src/game/upstream/lang/ 下所有带 strings.js 的语言目录。
 *
 * 语言包是「可增删」的资源：往这个目录里放一份就叫新增一门语言，不必改构建脚本；
 * 删掉就少一门。默认英文不依赖任何语言包 —— 没有登记表时 _() 原样返回 key。
 */
const availableLocales = () => {
  const langDir = path.join(UPSTREAM, "lang");
  if (!fs.existsSync(langDir)) {
    return [];
  }
  return fs
    .readdirSync(langDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(langDir, e.name, "strings.js")))
    .map((e) => e.name)
    .sort();
};

/**
 * 语言代码 → 显示名，照抄上游 lang/langs.js。
 *
 * 只用于生成游戏内语言菜单的条目文字。若某个语言包在这里没有对应条目，
 * 菜单会退化成直接显示语言代码 —— 仍可用，只是不好看。
 */
const LOCALE_NAMES = {
  cs: "czech",
  de: "deutsch",
  el: "ελληνικά",
  en: "english",
  eo: "esperanto",
  es: "español",
  fr: "français",
  gl: "galego",
  id: "bahasa indonesia",
  it: "italiano",
  ja: "日本語",
  ko: "한국어",
  lt_LT: "lietuvių",
  lv: "latviešu valoda",
  nb: "norsk",
  pl: "polski",
  pt: "português",
  pt_br: "português (brasil)",
  ru: "русский",
  sv: "svenska",
  th: "ไทย",
  tr: "türkçe",
  uk: "українська",
  vi: "tiếng việt",
  zh_cn: "简体中文",
  zh_tw: "繁體中文",
};

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
    id: "drop-jquery-script-transport",
    file: "lib/jquery.min.js",
    // jQuery 1.10.1 内建一个「跨域 script 传输」：当 $.ajax 的 dataType 是 script 且请求
    // 跨域时，它会 document.createElement("script")、把 s.url 赋给 src，再插进 <head> ——
    // 也就是**运行期动态加载并执行任意外部脚本**。这既是安全审计的必报项
    // （Code creates script elements at runtime），对本插件也毫无用处：
    // A Dark Room 全程不发跨域 script 请求（语言包已改为构建期登记、不落网络，
    // 见 upstream.meta.json 的 defer-language-pack），该分支是死代码。
    // 整段删掉后，万一真有代码走到这里，jQuery 会因找不到对应 transport 直接报错，
    // 而不是悄悄去加载远程脚本 —— 这正是想要的方向。
    expect: /,x\.ajaxTransport\("script",function\(e\)\{if\(e\.crossDomain\)\{/,
    apply: (src) => {
      // 注意前导的那个逗号必须一起吃进来：这段代码被压缩器并进了**逗号表达式**
      // （…x.ajaxSetup(…),x.ajaxPrefilter(…),x.ajaxTransport(…)…）。只删右操作数会留下
      // 一个悬空逗号，产出 `…}),/*…*/;var Fn=[]` 这种 esbuild 报 Unexpected ";" 的废码。
      const out = src.replace(
        /,x\.ajaxTransport\("script",function\(e\)\{if\(e\.crossDomain\)\{[\s\S]*?abort:function\(\)\{n&&n\.onload\(t,!0\)\}\}\}\}\)/,
        "/* [darkroom] removed: cross-domain script transport —— 原实现会动态创建一个 script 元素、把 s.url 赋给 src 再插进 head，即运行期加载并执行外部脚本 */"
      );
      // 宁可当场报错，也不要静默留下一条「能加载远程代码」的路径。
      if (out === src) {
        throw new Error('[build-game] 变换 "drop-jquery-script-transport" 的正则未删掉任何内容。');
      }
      if (out.indexOf('createElement("script")') !== -1) {
        throw new Error('[build-game] 变换 "drop-jquery-script-transport" 执行后仍残留 createElement("script")。');
      }
      return out;
    },
  },
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
  {
    id: "retarget-github-link",
    file: "script/engine.js",
    // 上游的 github 菜单项指向 A Dark Room 自己的仓库，且用 window.open 打开；
    // 这里两处一起改：
    //   · URL → 本项目仓库（与 manifest.json 的 author / authorUrl 一致）；
    //   · 打开方式 → 交给宿主。Electron 下直接 window.open 未必交给系统浏览器
    //     （可能被拦、开成空窗口或毫无反应），故由 __darkroomHost.openExternal 统一处理。
    expect: /window\.open\('https:\/\/github\.com\/doublespeakgames\/adarkroom'\)/,
    apply: (src) =>
      src.replace(
        /window\.open\('https:\/\/github\.com\/doublespeakgames\/adarkroom'\)/g,
        `__darkroomHost.openExternal(${JSON.stringify(PROJECT_URL)})`
      ),
  },
  {
    id: "drop-inline-button-width",
    file: "script/Button.js",
    // 上游让调用方用 options.width 指定按钮宽度，并写成**内联**样式：
    // room.js / outside.js / path.js 传 '80px'、ship.js 传 '100px'、fabricator.js 传 '150px'。
    // 那是为英文短文案调的。中文按钮文字更宽，宽度应由样式表统一决定 ——
    // 上游 css/main.css 本来就把 div.button 定为 100px（见 styles.css 的 #darkroom-root div.button）。
    // 只要这条内联还在，styles.css 就只能靠 !important 才能压住它；删掉它，宽度回归样式表。
    // 注意别误伤 events.js:1399 的 `Events.eventPanel().css('width', options.width)` ——
    // 那是给事件面板本身设宽度，不是按钮，本条按 file 限定，不会触及它。
    expect: /if\(options\.width\) \{\s*el\.css\('width', options\.width\);\s*\}/,
    apply: (src) =>
      src.replace(
        /if\(options\.width\) \{\s*el\.css\('width', options\.width\);\s*\}/,
        "/* [darkroom] removed: el.css('width', options.width) —— 按钮宽度改由样式表决定 */"
      ),
  },
  // 注意：语言包不写在这里 —— 它由 build() 里的 availableLocales() 动态扫描后逐个改写
  // （见下方「语言包」那段）。写成静态规则的话，语言列表一变（增删语言包）
  // 就会因「变换未生效」而直接报错。
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
 *   - lang/zh_cn/strings.js 在上游由 index.html 里的 document.write 动态注入。
 *     本移植**不拼接任何语言包** —— 只要不调用 _.setTranslation，翻译函数 _ 就会原样
 *     返回传入的 key，界面即为上游的英文原文。这正是「默认语言为英文」的实现方式。
 *     （该语言包仍随包分发于 src/game/upstream/lang/zh_cn/，留给将来的语言切换用。）
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
 *   - lib/jquery.min.js —— 上游优先从 Google CDN 取 jQuery，仅当 window.jQuery 不存在时
 *                          才用 document.write 回退加载本地这份。
 * 它必须随包分发（我们不放 CDN），故只从顺序校验中豁免。
 * （lang/zh_cn/strings.js 同属这一类，但本移植不再拼接它 —— 见 MODULES 上方的说明。）
 */
const DYNAMICALLY_LOADED = ["lib/jquery.min.js"];

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
 *   许可全文：A-DARK-ROOM-MPL-2.0.md
 *   来源与改动：THIRD_PARTY_NOTICES.md
 *   逐条改动登记：src/game/upstream.meta.json 的 buildTimeTransforms
 *
 * 上游各文件被拼接进同一 IIFE 作用域，其顶层 var 因此不会泄漏到 Obsidian 的 window。
 */`;

const PRELUDE = `export default function createDarkroomRuntime(locale) {
"use strict";

/* 本文件导出的是一个**工厂**而非单例：每次调用都得到一套全新的、彼此隔离的游戏实例
 * （各自的 jQuery、State（$SM）、计时器与事件订阅）。
 * 视图重建、存档导入都能因此直接推倒重来，不必去打扫上一局的残留状态 ——
 * 尤其是那串自续的 setTimeout 链，靠 dispose() 一次性清干净。
 *
 * locale 是界面语言的初始值（如 "zh_cn"；英文传 "en" 或不传）。
 * 它必须在**工厂执行时就应用**，而不是等 boot() —— 原因见下方「应用初始语言」那段。 */

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

/* 注意：语言表 __darkroomTranslations 不在本函数内，而在工厂**外面** ——
 * 见本文件「语言包登记表」那段。它在实例之间共享，全局只解析一次。 */
`;

/**
 * 语言包登记表：放在工厂**外面**。
 *
 * 为什么在外：每份 lang/<locale>/strings.js 是单行 60~70KB 的对象字面量，
 * 25 份合起来约 1.7MB。若放进工厂体内，每次切语言重建实例都要重新 parse 一遍，
 * 白白浪费；放在外面则整个进程只解析一次，各实例共享同一批表。
 *
 * 为什么「登记」而不「立即应用」：应用时机必须由调用方掌握 ——
 * 它必须早于任何含模块级 _() 的脚本（见 build() 里 lib/translate.js 之后那段）。
 */
const TRANSLATIONS_HEADER = `
/* ============ 语言包登记表（本移植新增，非上游代码） ============ */
/* 上游每份 lang/<locale>/strings.js 是「加载即生效」的一行 _.setTranslation({…})；
 * 构建期已把它改写成 __darkroomTranslations["<locale>"] = ({…}) —— 只登记、不应用。
 * 应用时机交给调用方：createDarkroomRuntime(locale) 在工厂最早处装表（用于启动），
 * 或运行中的实例调 setLanguage()（用于游戏内切换）。传 "en" 即回到英文原文。 */
var __darkroomTranslations = {};
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

  /**
   * 切换界面语言。
   *
   * 传入已登记的语言代码（构建期扫描 lang/ 目录得出）；找不到对应登记表就回到上游原文。
   * 注意：已经渲染到界面上的文字不会自动重绘 —— 宿主需要在切换后重建运行时
   * （设置项那边是 teardown + refresh），新文案才会出现。
   */
  setLanguage: function (name) {
    var table = __darkroomTranslations[name];
    _.setTranslation(table || null);
    return !!table;
  },

  /**
   * 已随包登记的语言代码列表（不含英文）。
   *
   * 英文是上游原文、不需要翻译表，所以不在这里 —— 宿主需自行把它补进语言选单。
   * 列表由构建期扫描 src/game/upstream/lang/ 得出，增删语言包即自动反映。
   */
  getLanguages: function () {
    return Object.keys(__darkroomTranslations);
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
  /** 游戏内的"重启"：存档已清空，宿主应据此重建运行时（上游此处是 location.reload()）。 */
  saveCleared(): void;
  /** 游戏内语言菜单被点击（Engine.switchLanguage 转发）。宿主应换翻译表并重建视图。 */
  switchLanguage(lang: string): void;
  /** 游戏想打开一个外部链接（github 菜单项；Electron 下须由宿主交给系统浏览器）。 */
  openExternal(url: string): void;
}

export interface DarkroomRuntime {
  setHost(host: Partial<DarkroomHost>): void;
  setRoot(el: HTMLElement): void;
  boot(options?: Record<string, unknown>): unknown;
  /** 切换界面语言（已随包登记的语言名；无对应表则回落英文原文）。 */
  setLanguage(name: string): boolean;
  /** 已随包登记的语言代码列表（不含英文 —— 英文是原文，无需翻译表）。 */
  getLanguages(): string[];
  /** 立即落盘当前存档。 */
  save(): void;
  /** 停止本实例的一切计时活动；此后该实例不可再用。 */
  dispose(): void;
  /** 上游 Engine 对象 —— 本移植只用到开关灯（主题同步）与语言切换。 */
  Engine: {
    isLightsOff?: () => boolean;
    turnLightsOff?: () => void;
    switchLanguage?: (lang: string) => void;
    [key: string]: unknown;
  };
  /** 上游 StateManager（路径语法见 api/DarkroomAPI.ts 的 getState 注释）。 */
  $SM: {
    get(path: string, requestZero?: boolean): unknown;
    set(path: string, value: unknown): void;
    add(path: string, delta: number): void;
    [key: string]: unknown;
  };
  /** 上游事件总线：Dispatch(name).subscribe(cb)。 */
  $: {
    Dispatch(name: string): { subscribe(callback: (payload?: unknown) => void): unknown };
    [key: string]: unknown;
  };
  modules: Record<string, unknown>;
  getState(): unknown;
}

/** 工厂：每次调用都得到一套全新的、彼此隔离的游戏实例。
 *
 * @param locale 初始界面语言（如 "zh_cn"；英文传 "en" 或省略）。
 *   必须在**工厂调用时**传入而非事后 setLanguage —— 上游有 234 处模块级 _() 调用
 *   在脚本加载时就求值了，晚于此刻的切换不会反映到那些常量上。 */
export default function createDarkroomRuntime(locale?: string): DarkroomRuntime;
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

    // ── 应用初始语言：必须紧跟 lib/translate.js ────────────────────────────
    //
    // 这里是整条语言链路上最关键的一处时序。上游有 234 处 _() 调用写在模块级的
    // 对象/数组字面量里（如 room.js 的 FireEnum.Burning.text = _('burning')、
    // outside.js 的 TrapDrops[].message、engine.js 的 perks 表），它们在**脚本加载时**
    // 求值一次就固定了，之后不再重算。
    //
    // 上游之所以没问题，是因为它的 lang/<locale>/strings.js 紧跟 translate.js 加载、
    // 加载即生效；切换语言则靠 location.href 整页重载，让所有模块常量重新求值。
    // 本移植把语言包改成「登记待用」后，若等到 boot() 才装表就太晚了 ——
    // 那时 translate.js 之后的所有模块都已求值完毕，模块级文案全部返回英文原文
    // （症状：骨架是中文，但「火堆 burning.」「房间 freezing.」这类零件是英文）。
    //
    // 所以：在 translate.js 装完（此刻 _ 已指向 translate）之后、其余脚本之前，
    // 立刻把表装上。工厂每次执行都会走到这里，故重建实例/切换语言都能重新求值。
    if (mod.file === "lib/translate.js") {
      chunks.push(`/* [本移植] 应用初始语言 —— 必须早于任何含模块级 _() 的脚本
 * （理由见构建脚本 scripts/build-game.mjs 中这一段的注释）。 */
if (locale && __darkroomTranslations[locale]) {
  _.setTranslation(__darkroomTranslations[locale]);
}`);
    }
  }

  // 语言包：扫描 src/game/upstream/lang/ 下所有 <locale>/strings.js，逐个登记进
  // __darkroomTranslations[locale]。
  //
  // 注意它们**不进 chunks**（那是工厂体内），而是单独成段、拼在工厂**外面**：
  // 每份是 60~70KB 的对象字面量，25 份约 1.7MB；放工厂内的话每次重建实例都要重新
  // parse 一遍。放外面则整个进程只解析一次，各实例共享。
  // 又因为只是赋值语句、与上游脚本的加载顺序无关，新增一门语言无需改代码 ——
  // 往 lang/ 里丢一份 strings.js 即可。
  const locales = availableLocales();
  const translationChunks = [];
  for (const locale of locales) {
    const rel = `lang/${locale}/strings.js`;
    const src = readUpstream(rel).replace(
      /_\s*\.\s*setTranslation\s*\(/,
      `__darkroomTranslations[${JSON.stringify(locale)}] = (`
    );
    translationChunks.push(`/* ================= ${rel} ================= */\n${src.trimEnd()}`);
  }
  if (locales.length) {
    console.log(`[build-game] 已登记语言包：${locales.join(", ")}`);
  } else {
    console.warn("[build-game] 未发现任何语言包 —— 界面只会是英文原文。");
  }

  // 语言菜单的数据源。
  //
  // 上游 engine.js:122 本来就有一段「在右下角菜单里追加语言下拉」的代码，
  // 整个块被 `if(typeof langs != 'undefined')` 守着 —— 而 langs 由 lang/langs.js 提供，
  // 本移植没有引入那个文件，于是这段菜单从来不出现。
  // 这里按「实际随包的语言」生成一份喂给它：显示名照抄上游 langs.js。
  // 注意 langs 是 PRELUDE 里的函数级变量，故这份数据必须留在工厂内（chunks）。
  //
  // **英文必须列进去**，且放在最前。
  // 英文没有语言包（lang/ 下没有 en 目录，界面原文即英文），但它是「切回原文」的出口 ——
  // 少了它，玩家切到中文之后就再也回不到英文了。选中 en 时：
  //   host.switchLanguage("en") → settings.language = "en" → 重建时
  //   createDarkroomRuntime("en")，而 __darkroomTranslations["en"] 是 undefined，
  //   于是不装翻译表，_() 原样返回 key —— 正是上游英文原文。
  if (locales.length) {
    const names = { en: LOCALE_NAMES.en };
    for (const locale of locales) {
      names[locale] = LOCALE_NAMES[locale] ?? locale;
    }
    chunks.push(`/* 语言菜单数据（本移植按实际随包语言生成） */\nlangs = ${JSON.stringify(names)};`);
  }

  // 各段之间用 "\n;\n" 而不是空行连接：上游文件原本靠换行 + ASI 分隔，拼接起来之后，
  // 若上一段以 } 或 ) 结尾、下一段以 ( 或 [ 开头，ASI 不会替我们插入分号 ——
  // 于是 "}\n(function(){…})()" 会被解析成"把对象当函数调用"，抛
  // "{…} is not a function"。（base64.js 正是以 `var Base64 = {…}` 结尾且无分号，
  // 紧随其后的就是 translate.js 的 IIFE。）补一个分号即可彻底规避这类问题。
  //
  // 结构（工厂外 → 工厂内）：
  //   BANNER
  //   语言包登记表（__darkroomTranslations，解析一次，实例共享）
  //   createDarkroomRuntime(locale) { PRELUDE + 各模块 + 应用 locale + EPILOGUE }
  const out = [
    BANNER,
    TRANSLATIONS_HEADER,
    translationChunks.join("\n;\n"),
    PRELUDE,
    chunks.join("\n;\n"),
    EPILOGUE,
  ].join("\n");

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
