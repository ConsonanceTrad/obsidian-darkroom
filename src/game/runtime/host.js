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
  importSave: function () {}
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
