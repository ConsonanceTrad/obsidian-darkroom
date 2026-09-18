/* 运行时宿主：由 Obsidian 插件在创建视图时注入。
 * 这里只放占位实现，保证上游代码即使尚未注入宿主也不会崩。 */

var __darkroomRoot = null;

var __darkroomHost = {
  load: function () {
    return undefined;
  },
  save: function () {},
  clear: function () {},
  setTitle: function () {},
  getTitle: function () {
    return "";
  },
  /* 上游的 Engine.event(cat, act) 原本只用于上报 Google Analytics。
   * 本移植不联网，改为把它转发到宿主 —— 这是游戏里唯一成体系的
   * 「里程碑」信号源（new game / combat / death / dungeon cleared / crash / win…），
   * 适合用来驱动与其它插件的联动。 */
  gameEvent: function () {},
  /* 游戏已把一份导入的存档写进存储桥，宿主应据此重建运行时。 */
  importSave: function () {},
  /* 游戏内的"重启"（engine-overrides.js 的 Engine.deleteSave 转发过来）：
   * 存档已被清空，宿主应重建运行时，让玩家从一张白纸重新开始。
   * 上游在这里是 location.reload()，在 Obsidian 里会重载整个应用，故改为回调。 */
  saveCleared: function () {},
  /* 游戏内语言菜单被点击（engine-overrides.js 的 Engine.switchLanguage 转发过来）。
   * lang 是语言代码，如 "zh_cn"。宿主应切换翻译表并重建视图，使界面文案生效。 */
  switchLanguage: function () {},
  /* 游戏想打开一个外部链接（构建期已把 github 菜单项的 window.open 改到这里）。
   * Electron 下直接 window.open 未必交给系统浏览器，故统一由宿主处理。 */
  openExternal: function () {}
};

function __setRoot(el) {
  __darkroomRoot = el || null;
}

function __setHost(host) {
  if (!host) {
    return;
  }
  for (var key in host) {
    if (Object.prototype.hasOwnProperty.call(host, key)) {
      __darkroomHost[key] = host[key];
    }
  }
}
