import { Notice, Plugin } from "obsidian";
import createDarkroomRuntime from "./game/generated/adr.runtime.js";
import type { DarkroomHost, DarkroomRuntime } from "./game/generated/adr.runtime.js";
import { DarkroomAPI } from "./api/DarkroomAPI";
import { DARKROOM_VIEW_TYPE, DarkroomView } from "./view/DarkroomView";
import { DEFAULT_SETTINGS, DarkroomSettingTab, type DarkroomSettings } from "./settings";

/**
 * 游戏 DOM 骨架，逐字取自上游 index.html 的 <body>。
 * 去掉的只有两样：指向 doublespeakgames.com 的品牌 logo 链接（游戏本体不用），
 * 以及 head 里的 SEO/analytics（那些本来就不进视图）。
 * #saveNotify 的文案对应上游 `_("saved.")`，这里直接写死中文 —— 本移植只有简体中文。
 */
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

interface PersistedData {
  store?: Record<string, string>;
  settings?: Partial<DarkroomSettings>;
}

export default class DarkroomPlugin extends Plugin {
  settings!: DarkroomSettings;
  api!: DarkroomAPI;

  private runtime: DarkroomRuntime | null = null;
  private root: HTMLElement | null = null;
  private store: Record<string, string> = {};
  private persistTimer: number | null = null;
  private lastTitle = "";
  private readonly handlers = new Map<string, Set<(payload?: unknown) => void>>();

  async onload(): Promise<void> {
    const data = (await this.loadData()) as PersistedData | null;
    this.store = data?.store ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});

    this.api = new DarkroomAPI(this);

    this.registerView(DARKROOM_VIEW_TYPE, (leaf) => new DarkroomView(leaf, this));

    this.addRibbonIcon("flame", "A Dark Room", () => {
      void this.openGame();
    });

    this.addCommand({
      id: "open",
      name: "打开 A Dark Room",
      callback: () => {
        void this.openGame();
      },
    });

    this.addCommand({
      id: "reset",
      name: "重开一局（清空存档）",
      callback: () => {
        this.resetGame();
        new Notice("Darkroom：存档已清空");
      },
    });

    this.addSettingTab(new DarkroomSettingTab(this.app, this));

    // 游戏主题跟随 Obsidian 的深/浅色设置（游戏内的"夜间模式"入口已在构建期移除）。
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.syncTheme();
      })
    );
  }

  onunload(): void {
    this.teardownRuntime();
    void this.persistNow();
  }

  // ── 视图生命周期 ────────────────────────────────────────────────

  /** 打开游戏视图；已经打开则聚焦既有视图。 */
  async openGame(): Promise<void> {
    const existing = this.getView();
    if (existing) {
      await this.app.workspace.revealLeaf(existing.leaf);
      return;
    }

    const leaf = this.settings.openInSidebar
      ? this.app.workspace.getRightLeaf(false)
      : this.app.workspace.getLeaf("tab");
    if (!leaf) {
      return;
    }
    await leaf.setViewState({ type: DARKROOM_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  getView(): DarkroomView | null {
    for (const leaf of this.app.workspace.getLeavesOfType(DARKROOM_VIEW_TYPE)) {
      if (leaf.view instanceof DarkroomView) {
        return leaf.view;
      }
    }
    return null;
  }

  // ── 运行时 ─────────────────────────────────────────────────────

  getRuntime(): DarkroomRuntime | null {
    return this.runtime;
  }

  /** 建立运行时与根容器（已存在则直接复用），返回根容器元素。 */
  ensureRuntime(): HTMLElement {
    if (this.runtime && this.root) {
      return this.root;
    }

    const root = document.createElement("div");
    root.id = "darkroom-root";
    root.innerHTML = SKELETON;

    const runtime = createDarkroomRuntime();
    // 顺序要紧：setRoot 必须在 boot 之前 —— engine.js 的 init 会调用
    // disableSelection()，那一步已经指向根容器。
    runtime.setRoot(root);
    runtime.setHost(this.createHost());

    this.runtime = runtime;
    this.root = root;

    // 上游的状态变更广播（StateManager 每次 set/add 都会 publish）转发出去，
    // 供外部插件订阅。注意这是高频事件，订阅方应自行节流。
    runtime.$.Dispatch("stateUpdate").subscribe((payload: unknown) => {
      this.emit("state-changed", payload);
    });

    return root;
  }

  /**
   * 启动游戏。**必须在根容器已经进入文档之后调用**。
   *
   * 上游 Engine.init() 用的是 document 级选择器 —— engine.js:116 的
   * `$('<div>').attr('id', 'locationSlider').appendTo('#main')`，以及 :120 的
   * `appendTo('body')`。根容器若还是游离节点，这些查询会命中空集：jQuery 不报错，
   * 于是整个界面静默地什么都不渲染（DOM 骨架在，但没有文字也没有图示）。
   */
  startRuntime(): void {
    if (!this.runtime) {
      return;
    }
    this.runtime.boot();
    this.syncTheme();
    this.emit("opened");
  }

  /**
   * 让游戏主题跟随 Obsidian 的深/浅色设置。
   *
   * 上游的深色主题来自 css/dark.css，它在本移植里被作用域化到根容器上的 `darkenLights` 类
   * （见 src/game/runtime/engine-overrides.js 对 Engine.turnLightsOff 的接管）。
   * 游戏内的"夜间模式"菜单项已在构建期删除，改由这里统一驱动：
   * Obsidian 用深色就加上这个类，浅色就去掉。
   */
  private syncTheme(): void {
    const root = this.root;
    const engine = this.runtime?.Engine as
      | { isLightsOff?: () => boolean; turnLightsOff?: () => void }
      | undefined;
    if (!root || !engine?.isLightsOff || !engine.turnLightsOff) {
      return;
    }

    const wantDark = document.body.classList.contains("theme-dark");
    if (engine.isLightsOff() !== wantDark) {
      // 上游这个函数名虽叫 Off，行为其实是切换。
      engine.turnLightsOff();
    }
  }

  /** 保存并销毁运行时（视图关闭、插件卸载、存档导入重启时调用）。 */
  teardownRuntime(): void {
    if (!this.runtime) {
      return;
    }
    this.runtime.save();
    this.runtime.dispose();
    this.runtime = null;
    this.root = null;
    void this.persistNow();
    this.emit("closed");
  }

  /** 清空存档并重开。 */
  resetGame(): void {
    this.store = {};
    const view = this.getView();
    this.teardownRuntime();
    void this.persistNow();
    view?.refresh();
  }

  /** 导入存档后重启运行时，使新存档生效。 */
  private restartRuntime(): void {
    const view = this.getView();
    this.teardownRuntime();
    view?.refresh();
  }

  // ── 宿主接口 ───────────────────────────────────────────────────

  private createHost(): Partial<DarkroomHost> {
    return {
      load: () => this.store,

      save: (state) => {
        this.store = state;
        this.schedulePersist();
      },

      clear: () => {
        this.store = {};
        this.schedulePersist();
      },

      // 上游会频繁写 document.title（切地点时）；在 Obsidian 里不能真的去改窗口标题，
      // 这里只记录下来，避免污染应用标题栏。
      setTitle: (title) => {
        this.lastTitle = title;
      },
      getTitle: () => this.lastTitle,

      // 上游的 Engine.event(cat, act) —— 游戏里所有成体系的节点都从这里发出。
      gameEvent: (category, action) => {
        this.emit("game-event", { category, action });
      },

      // 游戏导入了一份新存档：立刻落盘并重启运行时，取代上游的 location.reload()。
      importSave: (saveData) => {
        this.store.gameState = saveData;
        void this.persistNow();
        this.restartRuntime();
      },
    };
  }

  // ── 持久化 ─────────────────────────────────────────────────────

  private schedulePersist(): void {
    if (this.persistTimer !== null) {
      return;
    }
    // 游戏每次 set 都会触发一次；节流到 1.5s，避免频繁写盘。
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, 1500);
  }

  private async persistNow(): Promise<void> {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.saveData({ store: this.store, settings: this.settings } satisfies PersistedData);
  }

  async saveSettings(): Promise<void> {
    await this.persistNow();
  }

  // ── 事件 ───────────────────────────────────────────────────────

  on(event: string, handler: (payload?: unknown) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: (payload?: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  /** 广播事件：既走 Obsidian 工作区事件，也通知 DarkroomAPI 的订阅者。 */
  emit(event: string, payload?: unknown): void {
    this.app.workspace.trigger(`darkroom:${event}`, payload);
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        handler(payload);
      }
    }
  }
}
