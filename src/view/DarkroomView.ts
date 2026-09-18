import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type DarkroomPlugin from "../main";

export const DARKROOM_VIEW_TYPE = "darkroom-view";

export class DarkroomView extends ItemView {
  /** 标题栏上那个紧凑模式按钮，用于随状态更新图标与提示。 */
  private compactAction: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: DarkroomPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return DARKROOM_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "A Dark Room";
  }

  getIcon(): string {
    return "flame";
  }

  async onOpen(): Promise<void> {
    this.mountCompactAction();
    this.refresh();
  }

  async onClose(): Promise<void> {
    // 视图关闭即销毁运行时：存档落盘，那串自续的 setTimeout 链也一并清掉，
    // 游戏不会在后台继续空转。再次打开会新建实例并从存档恢复。
    this.plugin.teardownRuntime();
  }

  /**
   * 把紧凑模式按钮放到标题栏的**行首**（最左侧，即导航箭头之前）。
   *
   * 之所以不用 ItemView 自带的 addAction()：它只会把按钮追加到 .view-actions
   * （标题栏最右端）。
   *
   * 注意插入位置要选 .view-header 而不是 .view-header-title-container —— 后者的左边还有
   * 导航箭头（.view-header-nav-buttons），只插到标题容器前仍会落在箭头右侧，不是真正的行首。
   */
  private mountCompactAction(): void {
    const header = this.containerEl.querySelector<HTMLElement>(".view-header");
    if (!header) {
      return;
    }

    const btn = createDiv({ cls: "clickable-icon darkroom-compact-action" });
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      void this.plugin.toggleCompact();
    });
    header.prepend(btn);

    this.compactAction = btn;
    this.syncCompactAction();
  }

  /**
   * 同步标题栏按钮的外观。
   *
   * 紧凑模式开着时换成另一个图标并高亮，让当前处于哪种模式一眼可见 ——
   * 否则玩家只能靠通知栏的消失来推断。
   */
  syncCompactAction(): void {
    const el = this.compactAction;
    if (!el) {
      return;
    }
    const on = this.plugin.settings.compact;
    setIcon(el, on ? "panel-left-close" : "panel-left");
    const label = on
      ? "将信息流移回游戏内"
      : "将信息流移到侧边栏";
    el.setAttribute("aria-label", label);
    el.toggleClass("is-active", on);
  }

  /** 重建游戏 DOM。用于切换语言、导入存档、清档后重启运行时。 */
  refresh(): void {
    const root = this.plugin.ensureRuntime();
    this.contentEl.empty();
    this.contentEl.addClass("darkroom-container");
    // 先入文档再启动 —— 上游初始化用 document 级选择器，次序反了会静默不渲染。
    this.contentEl.appendChild(root);
    this.plugin.startRuntime();
  }
}
