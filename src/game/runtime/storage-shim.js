/* localStorage 垫片。
 *
 * 上游用裸 localStorage 读写存档：
 *     localStorage.gameState = JSON.stringify(State)   // 存
 *     JSON.parse(localStorage.gameState)               // 读
 *     localStorage.lang = lang                          // 语言
 *     localStorage.clear()                              // 清档
 * 而且开头都有 `typeof Storage != 'undefined' && localStorage` 这样的守卫。
 *
 * 这里用同名的局部变量遮蔽全局 localStorage，把读写转发给注入的宿主，
 * 于是存档落在 vault 内（随同步）而不是 Electron 的浏览器存储里，
 * 上游代码则完全不需要改动。
 *
 * 注意：上游是**属性式**访问（localStorage.gameState），不是 getItem/setItem，
 * 所以这里用 Proxy 兜住任意属性名，同时也实现标准的 Storage 方法。 */

var localStorage = (function () {
  var cache = {};
  var loaded = false;

  function ensure() {
    if (loaded) {
      return;
    }
    loaded = true;
    var raw = __darkroomHost.load();
    if (raw && typeof raw === "object") {
      cache = raw;
    }
  }

  function sync() {
    __darkroomHost.save(cache);
  }

  return new Proxy(
    {},
    {
      get: function (_target, prop) {
        if (prop === "getItem") {
          return function (key) {
            ensure();
            return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
          };
        }
        if (prop === "setItem") {
          return function (key, value) {
            ensure();
            cache[key] = String(value);
            sync();
          };
        }
        if (prop === "removeItem") {
          return function (key) {
            ensure();
            delete cache[key];
            sync();
          };
        }
        if (prop === "clear") {
          return function () {
            cache = {};
            loaded = true;
            __darkroomHost.clear();
          };
        }
        if (prop === "key") {
          return function (index) {
            ensure();
            var keys = Object.keys(cache);
            return index >= 0 && index < keys.length ? keys[index] : null;
          };
        }
        if (prop === "length") {
          ensure();
          return Object.keys(cache).length;
        }
        if (typeof prop !== "string") {
          return undefined;
        }
        ensure();
        return Object.prototype.hasOwnProperty.call(cache, prop) ? cache[prop] : undefined;
      },

      set: function (_target, prop, value) {
        ensure();
        cache[prop] = value;
        sync();
        return true;
      },

      deleteProperty: function (_target, prop) {
        ensure();
        delete cache[prop];
        sync();
        return true;
      },

      has: function (_target, prop) {
        ensure();
        return Object.prototype.hasOwnProperty.call(cache, prop);
      }
    }
  );
})();
