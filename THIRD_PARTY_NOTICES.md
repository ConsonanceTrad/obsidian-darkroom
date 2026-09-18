# 第三方来源与许可声明

本插件（Obsidian Darkroom）是 **A Dark Room** 的 Obsidian 移植版。
A Dark Room 的代码与素材并非本插件作者原创 —— 其版权与许可归属如下。

---

## 1. A Dark Room（主要来源）

| 项目 | 内容 |
| --- | --- |
| 名称 | A Dark Room — A Minimalist Text Adventure |
| 作者 / 版权 | Michael Townsend / Doublespeak Games |
| 上游仓库 | https://github.com/doublespeakgames/adarkroom |
| 上游分支 | `main` |
| 固定提交 | `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`（上游版本 v1.4） |
| 获取地址 | https://codeload.github.com/doublespeakgames/adarkroom/tar.gz/1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7 |
| 获取日期 | 2026-09-18 |
| 许可 | **Mozilla Public License 2.0 (MPL-2.0)** |
| 许可全文 | 本仓库根目录 [`A-DARK-ROOM-MPL-2.0.md`](./A-DARK-ROOM-MPL-2.0.md)（文件名刻意不含 `LICENSE` 词根 —— 含该词根的非标准后缀文件会被 GitHub 的 license 检测当成候选，从而干扰仓库级许可识别） |

上游源码随本仓库分发于 `src/game/upstream/`，**逐字节未作修改**（可用上表 tarball 逐个 `cmp` 比对）——**唯一的例外是样式表**：`css/**` 与 `lang/zh_cn/main.css` 已一次性作用域化、固化进根目录 [`styles.css`](./styles.css)，因此不再随本仓库分发。
按 MPL-2.0 §3.2 的要求，源码可得性由此满足：除样式表外的源码都在同仓库中，样式表的源码可由上表的上游仓库（或其 tarball）取得。

### 1.1 本插件对上游做的事

对**运行时代码**的所有改动都发生在**构建期**，只作用于生成物（`main.js` / `src/game/generated/adr.runtime.js`）；
`src/game/upstream/` 下的原始文件保持逐字节不变。
样式的处理则是一次性的历史转换：上游样式表当时被加上作用域前缀后固化为根目录 `styles.css`，此后该文件由本仓库手工维护，构建期不再生成或覆盖它。
逐条登记见 [`src/game/upstream.meta.json`](./src/game/upstream.meta.json) 的 `buildTimeTransforms` 字段：

1. **不加载任何外部脚本** — 上游 `index.html` 从 Google CDN 取 jQuery，并内嵌 Google Analytics（`gtag.js`，ID `G-606P6J79WH`）。本插件的构建只取 `index.html` 的 `<body>` 骨架与 `<script>` 加载顺序，其中的外链脚本一概忽略。
2. **jQuery 不污染全局** — jQuery 1.10.1 的 UMD 尾部在检测到 CommonJS 时会走 `module.exports` 分支。构建产物正是利用这一点取回实例，因此不会向 Obsidian 的 `window` 注入 `$` / `jQuery`。
3. **翻译函数 `_` 限定在作用域内** — 上游 `lib/translate.js` 结尾的 `window._ = translate;` 改为作用域内赋值。
4. **隐式全局改为显式预声明** — 上游有若干符号靠浏览器的非严格模式隐式挂到 `window` 上，而本插件的拼接产物带 ESM 语义即严格模式，给未声明变量赋值会直接抛 `ReferenceError`（表现为「一打开视图就报 `X is not defined`」）。完整名单由 `tsc` 对生成产物跑 `checkJs` 得出 —— 即 `Cannot find name` 的全部结果：
   `State`、`_`、`Engine`、`oldIE`、`Enemies`（`script/events/executioner.js:1` 的 `Enemies = window.Enemies ?? {}`）、`swipeElement`（`engine.js` 的 `Engine.init()`，boot 阶段即执行）、`elem`（`notifications.js` 的 `Notify`）、`craftable` 与 `good`（`room.js` / `fabricator.js` 事件处理函数之间跨作用域引用）、`c2` 与 `c3`（`setpieces.js` 剧情节点），以及上游用 `typeof` 守卫探测的 `define`、`ga`、`langs`（预声明后 `typeof` 仍为 `undefined`，行为不变）。
   复核命令：`npx tsc --noEmit --allowJs --checkJs --skipLibCheck --target ES2020 --lib DOM,ES2020 src/game/generated/adr.runtime.js`
5. **移除页面跳转** — `Engine.init()` 中指向 `browserWarning.html` / `mobileWarning.html` 的 `window.location` 赋值被移除（这两个页面也不随包分发）。否则在 Obsidian 中会令整个应用窗口跳转到不存在的页面。
6. **`body` 相关选择器重定向到游戏根容器** — 上游有两类写法：① `$('body')`，用于绑定键盘事件（`engine.js:204-205`）、太空过场改全屏背景色（`space.js` 多处）、事件聚焦（`events.js:1434`）；② 把 `'body'` 当方法参数传入的 `appendTo('body')` —— `engine.js:120` 用它建**主菜单**（重启 / 熄灯 / 分享 / 存档 / github 等），`space.js:292/464/517` 还有三处（`#starsContainer` 与两处太空过场元素）。②这类写法若不处理，元素会跑到根容器之外、并失去 `#darkroom-root` 前缀的样式，表现为整条主菜单不可见。构建期把两者一并重定向到游戏根容器。
7. **移除自启动** — 上游 `engine.js` 结尾的 `$(function() { Engine.init(); });` 被移除，改由插件在视图创建后显式调用，以便控制启动时机与生命周期。
8. **音频引擎以空实现顶替** — 音频文件不随包分发，构建期注入与上游 API 表面对齐的 no-op `AudioEngine`，使全量调用点原样工作且不产生任何网络或音频请求。
9. **存储桥接** — 上游使用的裸 `localStorage`（键 `gameState` / `lang`，并调用 `localStorage.clear()`）被转发到插件持久层，存档落在 vault 内而非 Electron 的浏览器存储。
10. **CSS 作用域化（一次性转换，结果已固化为根目录 `styles.css`）** — 为全部选择器加 `#darkroom-root` 前缀，并对 `body` / `html` / `::selection` / `@keyframes` 做专门处理，避免与 Obsidian 互相污染。该转换**不在构建期运行**：上游样式表已不再随仓库分发，根目录 `styles.css` 现在由本仓库直接维护（见该文件顶部的说明）。
11. **移除主菜单中的三项** — 应用商店（引导下载手机 App）、分享（外链社交）、夜间模式（改为跟随 Obsidian 的深/浅色设置）。构建期按块删除对应创建代码；`Engine.getApp` / `Engine.share` / `Engine.turnLightsOff` 函数本身保留（`turnLightsOff` 仍被启动逻辑与主题同步使用）。
12. **语言包改为「登记待用」，并在工厂启动时应用** — 上游每份 `lang/*/strings.js` 都是「加载即生效」：文件里唯一的一行 `_.setTranslation({…});` 一执行就整体切换界面语言。本移植把它们改写成 `__darkroomTranslations["<locale>"] = ({…});`（只替换开头，结尾的 `});` 原样保留，整句即成为合法赋值）。这批登记表放在生成文件导出的工厂 `createDarkroomRuntime(locale)` **外面**，整个进程只解析一次、各实例共享（25 份合计约 1.7MB，若放工厂内会随每次重建实例重复 parse）。

    **应用时机必须是工厂执行时，而不是 `boot()` 时**。原因：上游有 234 处 `_()` 调用写在**模块级**的对象/数组字面量里 —— 例如 `script/room.js` 的 `Freezing: { value: 0, text: _('freezing') }`、`script/outside.js` 的 `TrapDrops[].message`、`script/engine.js` 的 perks 表。它们在**脚本加载时**求值一次即固定，之后再换翻译表也不会变。上游之所以没这问题，是因为它的语言包紧跟 `lib/translate.js` 加载、加载即生效，且切换语言靠 `location.href` **整页重载**让所有模块常量重新求值；本移植若等到 `boot()` 才装表就太晚了，translate.js 之后的所有模块都已求值完毕，模块级文案会全部停在英文原文（症状：界面骨架是中文，但「火堆 burning.」「房间 freezing.」这类零件是英文）。因此构建期在 `lib/translate.js` 之后、其余脚本之前插入应用 locale 的语句；工厂每次执行都会走到那里，重建实例即重新求值。运行时另暴露 `setLanguage(name)`（命中登记表即 `_.setTranslation(表)`，否则以 `null` 复位 —— 按 `lib/translate.js` 的实现，此时 `_()` 原样返回 key，即上游英文原文）与 `getLanguages()`。构建期由 `availableLocales()` 扫描 `src/game/upstream/lang/` 得出语言清单，增删语言包无需改代码。
13. **主菜单的 github 项改指本项目，并由宿主打开** — 上游该项指向 A Dark Room 自己的仓库（`https://github.com/doublespeakgames/adarkroom`），且用 `window.open` 直接打开。本移植是独立插件，该按钮应指向本项目仓库（与 `manifest.json` 的 `author` / `authorUrl` 同为 `ConsonanceTrad`）；同时 Electron 环境下直接 `window.open` 未必交给系统浏览器（可能被拦、开成空白窗口或毫无反应），需由宿主接管。构建期把 `window.open('https://github.com/doublespeakgames/adarkroom')` 整句替换为 `__darkroomHost.openExternal("https://github.com/ConsonanceTrad/obsidian-darkroom")`；目标 URL 在 `scripts/build-game.mjs` 里以 `PROJECT_URL` 单点定义。宿主侧实现见 `src/main.ts` 的 `createHost().openExternal`（内部用 `window.open(url, "_blank")`，由 Obsidian 的 Electron 交给系统浏览器）。

### 1.2 未随包分发的上游文件

| 未引入项 | 原因 |
| --- | --- |
| `css/**`、`lang/zh_cn/main.css`（上游样式表） | 已一次性作用域化并固化进根目录 `styles.css`，不再随仓库分发；其源码按 MPL-2.0 §3.2 由上游仓库（见上表）提供。 |
| `audio/**`（86 个 flac 音效与配乐） | 本移植为**静音**分发。`script/audioLibrary.js`（常量表）保留，因为事件模块以 `AudioLibrary.XXX` 引用它；真正的播放引擎 `script/audio.js` 被排除。 |
| `img/**`（App Store / Google Play 下载徽章、五种浏览器图标、品牌 logo） | **游戏运行时不使用任何位图。** 上游仅有的引用都位于 `index.html` 的 `<head>` 元数据（`og:image`、`image_src`），以及只给 README 和 `browserWarning.html` 用。不引入同时也避免了 Apple / Google 徽章与各浏览器 logo 的商标使用问题。 |
| `lang/adarkroom.pot`、`tools/po2js.py`、`browserWarning.html`、`mobileWarning.html`、`doc/**`、`favicon.ico`、`script/dropbox.js`、`script/localization.js`、`lib/icu.js`、上游开发文件 | 与运行无关，详见 `src/game/upstream.meta.json` 的 `excludedReasons`。 |

---

## 2. 第三方库（随包的 `src/game/upstream/lib/`）

这些库是上游 `lib/` 目录的组成部分，本插件原样保留，未作修改。

### jQuery 1.10.1

| 项目 | 内容 |
| --- | --- |
| 版权 | Copyright 2005, 2013 jQuery Foundation, Inc. and other contributors |
| 许可 | **MIT** |
| 来源 | https://jquery.org/ |
| 随包文件 | `src/game/upstream/lib/jquery.min.js` |
| 文件内声明 | `/*! jQuery v1.10.1 \| (c) 2005, 2013 jQuery Foundation, Inc. \| jquery.org/license */` |

MIT 允许再分发，条件是在副本中保留版权声明与许可声明 —— 该声明随文件头部原样保留。

### jQuery Color 2.1.2

| 项目 | 内容 |
| --- | --- |
| 版权 | Copyright jQuery Foundation and other contributors |
| 许可 | **MIT**（jQuery 基金会的标准许可） |
| 来源 | https://github.com/jquery/jquery-color |
| 随包文件 | `src/game/upstream/lib/jquery.color-2.1.2.min.js` |
| 文件内声明 | `/*! jQuery Color v@2.1.2 http://github.com/jquery/jquery-color \| jquery.org/license */` |

### jquery.event.move 1.3.1 与 jquery.event.swipe 0.5

| 项目 | 内容 |
| --- | --- |
| 作者 | Stephen Band |
| 来源 | https://github.com/stephband/jquery.event.move |
| 随包文件 | `src/game/upstream/lib/jquery.event.move.js`、`src/game/upstream/lib/jquery.event.swipe.js` |
| 文件内声明 | **无** —— 这两个文件的头部仅有作者与版本注释，未附许可头（上游原文即如此，本插件未改动）。上游项目页标注为 MIT / GPL 双许可。 |

> 说明：为避免作出上游文件未声明的许可断言，此处如实记录"文件内无许可头"这一事实。若需再分发这两个文件，请自行核对上游项目页的许可条款。

### Base64 encode / decode

| 项目 | 内容 |
| --- | --- |
| 来源 | http://www.webtoolkit.info/ |
| 随包文件 | `src/game/upstream/lib/base64.js` |
| 文件内声明 | 仅标注来源 URL，未附许可声明。 |

用途：`engine.js` 的存档导入/导出功能（`Base64.encode` / `Base64.decode`）。

### translate.js

| 项目 | 内容 |
| --- | --- |
| 来源 | 上游 `lib/translate.js` 注释注明实现取自 https://gist.github.com/776196 与 http://davedash.com/2010/11/19/pythonic-string-formatting-in-javascript/ |
| 随包文件 | `src/game/upstream/lib/translate.js` |
| 文件内声明 | 未附许可声明。 |

用途：定义全局翻译函数 `_`，游戏全部界面文案都经它查表。

---

## 3. 简体中文翻译

`src/game/upstream/lang/zh_cn/` 下的 `strings.po` 与 `strings.js` 取自上游同名目录，许可同样为 **MPL-2.0**，版权归 Doublespeak Games 及其翻译贡献者，未作修改（该目录的 `main.css` 与其余 `lang/*/main.css` 一样，已并入根目录 `styles.css`，不再随仓库分发）。

其中 `strings.js` 是上游用 `tools/po2js.py` 从 `strings.po` 生成的产物；本插件把 `.po` 源文件也一并保留，便于日后直接校订中文文案。

---

## 4. 本插件自身代码

`src/` 下**除** `src/game/upstream/` 与 `src/game/generated/` 之外的文件 ——
即本移植的适配层（Obsidian 视图、存档桥、对外 API、构建脚本）—— 为本插件作者原创，
采用 **MIT** 许可，见本仓库根目录 [`LICENSE`](./LICENSE)。

根目录 [`styles.css`](./styles.css) 是**混合文件**，两部分要分开看待：

- 主体（各 `============ upstream … ============` 小节）是上游样式表的作用域化结果，仍受 **MPL-2.0** 覆盖；
- 末尾「本插件自身的样式」一节为本插件原创，属 **MIT**。

> 注意：这些原创文件**不会改变** `src/game/upstream/**` 中各文件的许可状态。
> MPL-2.0 是**逐文件**的 copyleft：它只约束被修改过的 MPL 覆盖文件，因此本插件可以把原创的适配层置于 MIT 之下，而 `src/game/upstream/**` 与 `styles.css` 中的上游部分仍属于 MPL-2.0。

---

## 5. 免责声明

本插件为个人学习与娱乐性质的移植，与 Doublespeak Games 无隶属或背书关系。
"A Dark Room" 的名称、游戏内容及其素材归其原作者所有。
