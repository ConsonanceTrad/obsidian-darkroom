/* 对 engine.js 三个函数的覆盖（紧跟 engine.js 之后插入，直接替换其原实现）。
 *
 * 之所以用"覆盖"而不是文本替换：这几个函数的原始实现跨多行、含嵌套分支，
 * 用正则去改很容易在别处误伤；直接重新定义既精确又容易复核。 */

/* --- 夜间模式（上游称 lights off） ---------------------------------------
 * 原实现依赖两样在 Obsidian 里都不成立的东西：
 *   1. Engine.findStylesheet() 遍历 document.styleSheets —— Obsidian 下这里有几十个
 *      样式表，又慢又可能误命中；
 *   2. turnLightsOff() 用 $('head').append('<link href="css/dark.css">') 动态插入，
 *      而该相对路径在 app:// 下无法解析，样式根本加载不进来。
 * 改为用根容器上的 darkenLights 类承载：css/dark.css 的规则会在 scope-css 阶段
 * 被加上 `#darkroom-root.darkenLights` 前缀，语义与上游一致。 */

Engine.findStylesheet = function () {
  return null;
};

Engine.isLightsOff = function () {
  return !!(__darkroomRoot && __darkroomRoot.classList.contains("darkenLights"));
};

Engine.turnLightsOff = function () {
  if (!__darkroomRoot) {
    return;
  }
  // 上游这个函数名虽是 "Off"，行为其实是切换。
  var isOff = __darkroomRoot.classList.toggle("darkenLights");
  $(".lightsOff").text(_(isOff ? "lights on." : "lights off."));
  $SM.set("config.lightsOff", isOff, true);
};

/* --- 语言切换 -------------------------------------------------------------
 * 原实现改写 document.location.href（追加 ?lang=xx），会让整个 Obsidian 窗口重载。
 * 本移植仅提供简体中文，也没有语言菜单（lang/langs.js 未随包分发），故直接停用。 */

Engine.switchLanguage = function () {
  /* [darkroom] 语言切换不可用 */
};

/* --- 里程碑埋点 -----------------------------------------------------------
 * 上游的 Engine.event(cat, act) 只在 window.ga 存在时才做事（上报 Google Analytics），
 * 而本移植不加载任何外部脚本，所以它本来就是空转。
 * 这里接管它并转发给宿主：游戏里所有成体系的节点都由它发出 ——
 *   progress : new game / path / outside / iron mine / coal mine / sulphur mine /
 *              dungeon cleared / ship / crash / win / import / export
 *   game event: combat / event / death
 * 这是外部插件做联动最合适的信号源。 */

Engine.event = function (cat, act) {
  try {
    __darkroomHost.gameEvent(cat, act);
  } catch (e) {
    /* 联动方的异常不应影响游戏本身 */
  }
};

/* --- 导入存档 -------------------------------------------------------------
 * 原实现末尾是 location.reload() —— 在 Obsidian 里会重载整个应用窗口。
 * 改为：把解码后的存档写进存储桥并立刻落盘，然后交给宿主重建运行时。 */

Engine.import64 = function (string64) {
  var cleaned = String(string64).replace(/\s/g, "").replace(/\./g, "").replace(/\n/g, "");
  var decoded = Base64.decode(cleaned);
  localStorage.gameState = decoded;
  __darkroomHost.importSave(decoded);
};

/* --- 生命周期：计时器归属 -------------------------------------------------
 * 游戏的全部循环（生火、工人、建造、旅行进度、事件推进…）都建立在
 * Engine.setTimeout / Engine.setInterval 的递归链上，而且这些链是自续的：
 * 只要不拦，视图关掉后它们仍会一直跑，持续操作已经被移除的 DOM。
 * 这里把两者包一层，记录本实例登记过的计时器（回调触发即从表里摘除，故不会无限增长），
 * dispose() 时一并清掉，实例即可被安全丢弃。 */

var __timers = new Map();
var __disposed = false;

var __rawSetTimeout = Engine.setTimeout;
var __rawSetInterval = Engine.setInterval;

Engine.setTimeout = function (callback, timeout, skipDouble) {
  if (__disposed) {
    return null;
  }
  var id = __rawSetTimeout(
    function () {
      __timers.delete(id);
      callback();
    },
    timeout,
    skipDouble
  );
  __timers.set(id, "timeout");
  return id;
};

Engine.setInterval = function (callback, interval, skipDouble) {
  if (__disposed) {
    return null;
  }
  var id = __rawSetInterval(
    function () {
      callback();
    },
    interval,
    skipDouble
  );
  __timers.set(id, "interval");
  return id;
};

/** 停止本实例的一切计时活动并标记为已销毁。之后 boot/restart 不再生效。 */
function __dispose() {
  if (__disposed) {
    return;
  }
  __disposed = true;
  __timers.forEach(function (type, id) {
    if (type === "interval") {
      clearInterval(id);
    } else {
      clearTimeout(id);
    }
  });
  __timers.clear();
}
