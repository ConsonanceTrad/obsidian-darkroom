import { ItemView, type WorkspaceLeaf, type ViewStateResult } from "obsidian";
import type DarkroomPlugin from "../main";

export const DARKROOM_PANEL_VIEW_TYPE = "darkroom-panel";

/**
 * 可以外移到侧栏的游戏面板 —— 目前**只有信息流**。
 *
 * 库存栏刻意不在其中。它曾是第二项，但带来两个上游层面的麻烦，且收益为零：
 *   · 它的位置由 world.js / outside.js / path.js 用 .css() 反复改写（inline style），
 *     要一路 !important 压住；
 *   · 它是 #roomPanel 内的固定 200px 两列布局，脱离根容器后作用域化样式全部失效；
 *   · 它靠 right: 0 贴边，本就不占额外宽度 —— 真正让本体变宽的是通知栏那 220px。
 *
 * 更要紧的是安全：外移是「归还 → 重新搬入」的循环（切语言会走一遍），
 * 名单里多一个元素就多一次「搬错地方」的机会 —— 曾出现切语言时把库存搬进信息流侧栏。
 * 去掉它，这类错误在类型层面即不可能发生（PanelKind 由本表推导）。
 */
export const PANEL_SOURCE = {
  notifications: { selector: "#notifications", home: "#wrapper" },
} as const;

export type PanelKind = keyof typeof PANEL_SOURCE;

export const PANEL_TITLE: Record<PanelKind, string> = {
  notifications: "信息流",
};

/**
 * 承载被外移出来的游戏面板。
 *
 * 为什么用「搬移」而不是「镜像」：上游全程用 `prependTo('div#notifications')` 这类
 * **按 id** 的查询来重绘（jQuery 的 id 选择器最终走 getElementById），所以只要元素仍在
 * 文档内，把它换一个父节点挂上去，上游的重绘逻辑一行都不用改就会继续正常写入。
 *
 * 反过来，若做镜像就得劫持上游的重绘逻辑去同步两份 DOM，实现量和出错面都大得多。
 *
 * 本视图只负责「把元素搬进来 / 还回去」，具体找元素和归位的逻辑在插件里
 * （adoptPanel / releasePanel），因为它们需要访问当前 runtime 的根容器。
 */
export class DarkroomPanelView extends ItemView {
  private kind: PanelKind = "notifications";

  constructor(leaf: WorkspaceLeaf, private readonly plugin: DarkroomPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return DARKROOM_PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `A Dark Room · ${PANEL_TITLE[this.kind]}`;
  }

  getIcon(): string {
    return "scroll-text";
  }

  /**
   * 由 Obsidian 在建视图后调用，回填 setViewState 里传入的 state。
   *
   * 需要实现（ItemView 的默认 setState 是空实现，而 Obsidian 靠它递入我们传的 state）。
   * 不过**不能只依赖它**：实测 state 有时并不会回填（日志里 stateWhich 为 undefined），
   * 所以插件侧的归还逻辑走的是 releaseAllPanels()，与本视图记住的 kind 无关。
   */
  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const s = state as { which?: PanelKind } | null;
    if (s?.which && s.which in PANEL_SOURCE) {
      this.kind = s.which;
    }
    // 此刻 contentEl 才真正入文档（onOpen 阶段实测 isConnected === false），
    // 所以搬移要在这里做，否则元素会进一个尺寸为 0 的容器。
    this.refresh();
  }

  /** 回读用；也让 getViewState().state.which 有意义。 */
  getState(): Record<string, unknown> {
    return { which: this.kind };
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("darkroom-panel");
    this.contentEl.addClass(`darkroom-panel-${this.kind}`);
  }

  async onClose(): Promise<void> {
    // 侧栏被关掉时把元素还给游戏，否则它会随着这个 leaf 一起被丢弃。
    this.plugin.releasePanel(this.kind);
  }

  /**
   * 重新取用游戏里的对应元素。
   *
   * 不只是 setState 会调用 —— runtime 重建（切语言、导入存档、清档）之后，游戏会生成
   * 一整套新的 DOM，旧元素随之被丢弃。此时必须重新取一次，否则侧栏会停留在孤儿节点上。
   */
  refresh(): void {
    this.plugin.adoptPanel(this.kind, this.contentEl);
  }
}
