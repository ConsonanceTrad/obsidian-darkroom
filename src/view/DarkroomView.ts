import { ItemView, type WorkspaceLeaf } from "obsidian";
import type DarkroomPlugin from "../main";

export const DARKROOM_VIEW_TYPE = "darkroom-view";

export class DarkroomView extends ItemView {
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
    this.refresh();
  }

  async onClose(): Promise<void> {
    // 视图关闭即销毁运行时：存档落盘，那串自续的 setTimeout 链也一并清掉，
    // 游戏不会在后台继续空转。再次打开会新建实例并从存档恢复。
    this.plugin.teardownRuntime();
  }

  /** 重建游戏 DOM。用于导入存档后重启运行时。 */
  refresh(): void {
    const root = this.plugin.ensureRuntime();
    this.contentEl.empty();
    this.contentEl.addClass("darkroom-container");
    // 先入文档再启动 —— 上游初始化用 document 级选择器，次序反了会静默不渲染。
    this.contentEl.appendChild(root);
    this.plugin.startRuntime();
  }
}
