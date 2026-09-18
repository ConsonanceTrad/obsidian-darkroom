#!/usr/bin/env node
/**
 * 运行时冒烟测试：在既没有 Obsidian、也没有浏览器的 Node 环境里，
 * 用一个最小 DOM（jsdom）把生成出来的运行时加载起来。
 *
 * 它验证的不是玩法，而是**构建期拼接有没有破坏作用域**。
 * 上游几十个文件靠同一作用域里的顶层 var 互相引用（$SM、Engine、Events、Room…），
 * 一旦拼接出错，最典型的表现就是加载或初始化时抛 ReferenceError；
 * 这类错误平时只能在 Obsidian 里才看得到，代价很高，所以在这里先拦一道。
 *
 * 用法：node scripts/smoke-runtime.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUNTIME = path.join(ROOT, "src", "game", "generated", "adr.runtime.js");

if (!fs.existsSync(RUNTIME)) {
  console.error(`[smoke] 找不到 ${RUNTIME}\n        请先执行 npm run build（它会先生成运行时）。`);
  process.exit(2);
}

/** 与 src/main.ts 里的 SKELETON 保持一致。 */
const SKELETON = `<div id="wrapper">
	<div id="saveNotify">已保存</div>
	<div id="content">
		<div id="outerSlider">
			<div id="main">
				<div id="header"></div>
			</div>
		</div>
	</div>
</div>`;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://darkroom.invalid/",
});

// 把 jsdom 的 window 铺成全局，让产物里的 window / document / location 都解析到它。
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// 注意：Node 24 里 globalThis.navigator 是只读 getter，赋值会抛 TypeError。
// 也不需要替换 —— Node 自带的 navigator 就有 userAgent，而上游只用 navigator.userAgent
// 判断是否移动端（Engine.isMobile）；Node 的 UA 不含 Android/iPhone，正合预期。
globalThis.location = dom.window.location;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Storage = dom.window.Storage;
globalThis.XMLHttpRequest = dom.window.XMLHttpRequest;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const failures = [];
const note = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log("[smoke] 加载拼接产物…");
let createDarkroomRuntime;
try {
  ({ default: createDarkroomRuntime } = await import(pathToFileURL(RUNTIME).href));
} catch (err) {
  console.error("[smoke] 加载产物失败（这是致命错误，通常意味着拼接破坏了作用域）:");
  console.error(err);
  process.exit(1);
}
note("运行时模块加载", typeof createDarkroomRuntime === "function");

console.log("[smoke] 创建运行时实例…");
let runtime;
try {
  runtime = createDarkroomRuntime();
} catch (err) {
  console.error("[smoke] createDarkroomRuntime() 抛错:");
  console.error(err);
  process.exit(1);
}
note("createDarkroomRuntime() 未抛错", true);

// 上游的全局符号是否都被正确收进作用域（漏掉任何一个都可能表现为 ReferenceError）。
const symbols = ["Engine", "$SM", "$"];
for (const name of symbols) {
  note(`runtime.${name} 存在`, runtime[name] !== undefined && runtime[name] !== null);
}
for (const name of ["Room", "World", "Outside", "Path", "Events", "Notifications", "Ship", "Space", "Fabricator"]) {
  note(`runtime.modules.${name} 存在`, Boolean(runtime.modules[name]));
}

note("$SM.get 是函数", typeof runtime.$SM.get === "function");
note("$SM.set 是函数", typeof runtime.$SM.set === "function");
note("Engine.init 是函数", typeof runtime.Engine.init === "function");
note("dispose 是函数", typeof runtime.dispose === "function");
note("save 是函数", typeof runtime.save === "function");

// 检查构建期替换确实生效：不该再有指向全局 window 的挂载点。
note("Engine 未挂到 window", dom.window.Engine === undefined, `window.Engine=${dom.window.Engine}`);
note("jQuery 未挂到 window", dom.window.jQuery === undefined && dom.window.$ === undefined);
note("_ 未挂到 window", dom.window._ === undefined);

console.log("[smoke] 注入 DOM 骨架并启动…");
const root = dom.window.document.createElement("div");
root.id = "darkroom-root";
root.innerHTML = SKELETON;
dom.window.document.body.appendChild(root);

runtime.setRoot(root);
runtime.setHost({
  load: () => ({}),
  save: () => {},
  clear: () => {},
  setTitle: () => {},
  getTitle: () => "",
  gameEvent: () => {},
  importSave: () => {},
});

// boot() 会真正跑 Engine.init()：在 jsdom 里可能因为缺少某些浏览器能力而抛出
// 与 DOM 相关的错误，那属于预期之内；但 ReferenceError 绝不允许 —— 那就说明拼接漏了符号。
try {
  runtime.boot();
  note("boot() 未抛错", true);
} catch (err) {
  if (err instanceof ReferenceError) {
    console.error("[smoke] boot() 抛出 ReferenceError —— 拼接作用域有问题:");
    console.error(err);
    process.exit(1);
  }
  note("boot() 在 jsdom 下抛出了非 ReferenceError 的异常（可接受）", true, err.message);
}

runtime.dispose();
note("dispose() 未抛错", true);

console.log("");
if (failures.length > 0) {
  console.error(`[smoke] 失败 ${failures.length} 项：${failures.join(", ")}`);
  process.exit(1);
}
console.log("[smoke] 全部通过。");
