import { Notice, Plugin } from "obsidian";
import createDarkroomRuntime from "./game/generated/adr.runtime.js";
import type { DarkroomHost, DarkroomRuntime } from "./game/generated/adr.runtime.js";
import { DarkroomAPI } from "./api/DarkroomAPI";
import { DARKROOM_VIEW_TYPE, DarkroomView } from "./view/DarkroomView";
import {
  DARKROOM_PANEL_VIEW_TYPE,
  DarkroomPanelView,
  PANEL_SOURCE,
  type PanelKind,
} from "./view/DarkroomPanelView";
import { DEFAULT_SETTINGS, type DarkroomSettings } from "./settings";

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
    this.registerView(DARKROOM_PANEL_VIEW_TYPE, (leaf) => new DarkroomPanelView(leaf, this));

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
      id: "toggle-compact",
      name: "将库存与信息流移到侧边栏",
      callback: () => {
        void this.toggleCompact();
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

    // 游戏主题跟随 Obsidian 的深/浅色设置（游戏内的"夜间模式"入口已在构建期移除）。
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.syncTheme();
      })
    );
  }

  onunload(): void {
    // 先收侧栏：它会触发各 DarkroomPanelView.onClose，把库存/信息流还回游戏树，
    // 否则这些元素会跟着被 detach 的 leaf 一起丢掉。
    this.app.workspace.detachLeavesOfType(DARKROOM_PANEL_VIEW_TYPE);
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

    // 固定开在主工作区的新标签页 —— 侧边栏太窄，游戏排不下（上游本就是 920px 宽的一整块）。
    const leaf = this.app.workspace.getLeaf("tab");
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
    // 紧凑模式记得生效：连同它的根容器类一起恢复，否则重启后布局会回到 920px。
    root.classList.toggle("compact", this.settings.compact);

    // 语言必须在**创建实例时**就定好：上游有 234 处 _() 写在模块级字面量里，
    // 工厂一执行就求值了，事后再 setLanguage 改不动它们（见 build-game.mjs 的说明）。
    const runtime = createDarkroomRuntime(this.settings.language);
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
    // 语言表其实在 createDarkroomRuntime(locale) 时就装好了（模块级 _() 的求值时机
    // 决定了必须那么早）。这里再设一次是无害的兜底，同时也覆盖「实例建好后语言又被
    // 改过」的情形；Engine.init() 会立刻渲染第一批文案，故必须在 boot 之前。
    this.runtime.setLanguage(this.settings.language);
    this.runtime.boot();
    this.syncTheme();
    this.emit("opened");

    // boot 之后 DOM 才齐全（库存栏是 Room.init 时创建的、通知栏是 Notifications.init 时创建的），
    // 此刻才能把两块面板交给侧栏。重载插件后设置里若仍是紧凑模式，这一步负责把侧栏重新展开。
    void this.applyCompact();
  }

  /**
   * 重建视图（拆掉运行时再让视图重新挂载）。
   *
   * 用于那些「改了必须重新初始化才生效」的设置 —— 目前是界面语言：
   * 文案已经渲染进 DOM 了，光换翻译表不会重绘。拆之前会先 save + 落盘，进度不丢。
   */
  rebuildView(): void {
    const view = this.getView();
    this.teardownRuntime();
    view?.refresh();
    // 新的 DOM 已就位，侧栏要重新取一次元素，否则会挂在被丢弃的旧节点上。
    this.syncPanels();
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
    // 先把被搬进侧栏的元素归位，再销毁运行时：否则它们会留在一个即将被丢弃的 DOM 里，
    // 之后即使重建 runtime，侧栏也只会挂着一堆孤儿节点（信息流就此永久消失）。
    this.releaseAllPanels();
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
    this.syncPanels();
  }

  /** 导入存档后重启运行时，使新存档生效。 */
  private restartRuntime(): void {
    const view = this.getView();
    this.teardownRuntime();
    view?.refresh();
    this.syncPanels();
  }

  // ── 紧凑模式：把两块附属面板外移到侧边栏 ─────────────────────────
  //
  // 背景：游戏本体是 920px 宽的一整块（= #wrapper 内容 700px + 它左侧 220px 的
  // 通知栏内边距）。视图比这更窄时两侧会被裁，而这两块面板恰恰是宽度的主要来源。
  // 紧凑模式把它们搬到 Obsidian 自己的左右侧边栏，本体随即收窄到 700px。
  //
  // 采用「搬移」而非「镜像」：上游全程用 `$('#storesContainer')`、
  // `prependTo('div#notifications')` 这类**按 id** 的查询重绘（jQuery 的 id 选择器
  // 最终走 getElementById），所以把元素换个父节点挂上去，上游代码一行都不用改；
  // 若做镜像就得劫持上游的重绘逻辑去同步两份 DOM，得不偿失。

  /** 切换紧凑模式并落盘。 */
  async toggleCompact(): Promise<void> {
    this.settings.compact = !this.settings.compact;
    await this.saveSettings();
    await this.applyCompact();
  }

  /** 按当前 settings.compact 收放侧栏。 */
  async applyCompact(): Promise<void> {
    this.root?.classList.toggle("compact", this.settings.compact);

    if (this.settings.compact) {
      // 只外移信息流。
      //
      // 库存栏刻意不参与（原因见 DarkroomPanelView 里 PANEL_SOURCE 的注释）：它的位置由
      // world.js / outside.js / path.js 反复改写，脱离根容器后样式失效，而它靠 right:0 贴边、
      // 本就不占额外宽度。真正让本体变宽的是通知栏那 220px。
      // 名单里少一个元素，也就少一次「搬错地方」的机会 —— 曾出现切语言时把库存搬进信息流侧栏。
      //
      // 幂等：已经开着就只换内容，不重建视图。
      // 切语言会走 teardownRuntime() → startRuntime() → applyCompact()，若无条件
      // setViewState，侧栏会被整个重建一遍（表现为「又渲染出一个新的信息流侧栏」、伴随闪动）。
      if (this.app.workspace.getLeavesOfType(DARKROOM_PANEL_VIEW_TYPE).length > 0) {
        this.syncPanels();
      } else {
        await this.openPanel("notifications", "left");
      }
    } else {
      // 顺序**必须**是先归还、再销毁 leaf。
      //
      // #notifications 此刻就住在侧栏的 contentEl 里；detachLeavesOfType 会连同那棵 DOM
      // 一起销毁它 —— 之后再调 releasePanel 只会拿到 elementFound: false，元素永久丢失
      // （症状：还原后信息流再也不显示）。日志里 onClose 那条警告同理：它由 detach 触发，
      // 那时元素已经没了，所以 onClose 里的归还也**不可依赖**。
      //
      // 这里按 PANEL_SOURCE 逐个归还（不依赖视图记的 kind —— 那个 kind 依赖 Obsidian 回填
      // state，实测不可靠）。归位后元素已在 #wrapper 内，leaf 随之销毁也不会波及它。
      this.releaseAllPanels();
      this.app.workspace.detachLeavesOfType(DARKROOM_PANEL_VIEW_TYPE);
    }

    this.getView()?.syncCompactAction();
  }

  private async openPanel(kind: PanelKind, side: "left" | "right"): Promise<void> {
    const leaf =
      side === "left"
        ? this.app.workspace.getLeftLeaf(false)
        : this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      return;
    }

    // 先把侧栏展开，再装视图。
    //
    // 侧栏可能处于折叠状态（宽度为 0），此时 setViewState 只是把视图塞进去，用户什么都看不到 ——
    // 表现为「开了紧凑模式，但两侧空无一物」。必须显式 expand 对应的 split。
    // 顺序也要紧：折叠状态下 leaf 的容器尺寸为 0，先 expand 才能让随后的尺寸计算拿到真实宽度。
    const split = side === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
    split?.expand();

    // which 由 DarkroomPanelView 从 getState() 读回，故只需注册一个视图类型。
    //
    // active 必须为 true：侧栏里可能堆着别的标签，active:false 只是把视图装进 leaf，
    // 却不让它成为该侧栏的活动标签 —— 于是侧栏仍显示旧标签，用户看不到我们的面板
    // （症状：侧栏展开了，但里面是空的，像是"没跳过去"）。
    await leaf.setViewState({
      type: DARKROOM_PANEL_VIEW_TYPE,
      active: true,
      state: { which: kind },
    });

    // setViewState 之后元素才真正进入文档；此刻再取一次，避免 refresh 早于 DOM 就位而落空。
    const view = leaf.view;
    if (view instanceof DarkroomPanelView) {
      view.refresh();
    }
  }

  /** 侧栏请求接管某块面板：把它从游戏根容器搬进 target。 */
  adoptPanel(kind: PanelKind, target: HTMLElement): void {
    const el = this.findPanelElement(kind);
    if (!el) {
      // 只在异常路径出声，不打扰正常流程。
      console.warn("[darkroom] adoptPanel 找不到元素", {
        kind,
        selector: PANEL_SOURCE[kind].selector,
        rootExists: !!this.root,
      });
      return;
    }
    target.appendChild(el);
  }

  /**
   * 归还所有可能被搬走的元素。
   *
   * 关闭紧凑模式时必须走这一步，而不能只依赖各视图 onClose 里那次 releasePanel：
   * 视图实例的 kind 依赖 Obsidian 回填 state（实测不可靠，见 applyCompact 的注释），
   * 认错了就会漏还、把元素留在即将被丢弃的侧栏里。
   * 这里按 PANEL_SOURCE 逐个归还，与视图的记忆无关。
   */
  releaseAllPanels(): void {
    for (const kind of Object.keys(PANEL_SOURCE) as PanelKind[]) {
      this.releasePanel(kind);
    }
  }

  /**
   * 侧栏关闭：把面板元素归还游戏（放回它在上游的原位）。
   *
   * 两个查找都带**全文档兜底**，这是必需的：重启 Obsidian 时侧栏 leaf 会被 workspace
   * 布局一起恢复，而那一刻游戏视图可能还没打开（this.root 为 null）—— 若只查 root，
   * 归还就会静默失败，元素留在已被丢弃的侧栏里（症状：重启后一还原，信息流再也不显示）。
   */
  releasePanel(kind: PanelKind): void {
    const el = this.findPanelElement(kind);
    const home =
      this.root?.querySelector<HTMLElement>(PANEL_SOURCE[kind].home) ??
      document.querySelector<HTMLElement>(PANEL_SOURCE[kind].home);
    if (!el || !home) {
      console.warn("[darkroom] releasePanel 无法归还", {
        kind,
        elementFound: !!el,
        homeFound: !!home,
        homeSelector: PANEL_SOURCE[kind].home,
        rootExists: !!this.root,
      });
      return;
    }
    // 已经在原位就不必再动。
    if (el.parentElement === home) {
      return;
    }
    home.appendChild(el);
  }

  /**
   * runtime 重建之后重新取用面板元素。
   *
   * 重建会生成一整套新 DOM，旧元素随之被丢弃；此时侧栏若还挂着旧节点就成了孤儿。
   * 各 DarkroomPanelView 重新 refresh 一次即可取到新元素。
   */
  syncPanels(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DARKROOM_PANEL_VIEW_TYPE)) {
      if (leaf.view instanceof DarkroomPanelView) {
        leaf.view.refresh();
      }
    }
  }

  /**
   * 找到某块面板元素。
   *
   * 注意必须先查游戏根容器、再退回全文档：元素一旦被搬进侧栏就离开了 root，
   * 若只查 root，后续每一次查找都会返回 null 并静默跳过 —— 表现为「第一次搬成功，
   * 之后重建/同步就再也搬不动」。退回全文档查找即可覆盖已搬走的情形。
   */
  private findPanelElement(kind: PanelKind): HTMLElement | null {
    const selector = PANEL_SOURCE[kind].selector;
    return (
      this.root?.querySelector<HTMLElement>(selector) ??
      document.querySelector<HTMLElement>(selector)
    );
  }

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

      // 游戏内的"重启"（见 engine-overrides.js 的 Engine.deleteSave）：
      // 存档已被清空，立刻落盘并重建运行时，从一张白纸重新开始。
      // 上游在这里是 location.reload()，在 Obsidian 里会重载整个应用。
      saveCleared: () => {
        this.store = {};
        void this.persistNow();
        this.restartRuntime();
      },

      // 游戏内语言菜单被点击（见 engine-overrides.js 的 Engine.switchLanguage）。
      // 上游原本靠改 location.href 整页重载来换语言，那会把整个 Obsidian 窗口跳走；
      // 这里改成记下选择、并把界面重建一遍 —— 文案是渲染期查表的，必须重建才生效。
      switchLanguage: (lang) => {
        if (!lang || lang === this.settings.language) {
          return;
        }
        this.settings.language = lang;
        void this.saveSettings();
        // 延后一帧再拆：此刻还站在游戏自己的点击回调里，立刻 teardown 会把
        // 调用栈脚下的 DOM 抽掉。等这次事件处理完再重建。
        window.setTimeout(() => this.rebuildView(), 0);
      },

      // 游戏要打开外部链接（github 菜单项）。
      // 上游直接用 window.open；在 Obsidian 的 Electron 里它未必交给系统浏览器
      // （可能被拦、开成空白窗口或毫无反应），故统一在这里处理。
      openExternal: (url) => {
        window.open(url, "_blank");
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
