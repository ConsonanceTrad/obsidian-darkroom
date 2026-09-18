/**
 * 插件持久化设置。
 *
 * 这里**没有**设置面板 —— 语言跟原版一样在游戏内右下角菜单切换
 * （由 main.ts 的 host.switchLanguage 写回）；「紧凑模式」则由游戏视图标题栏上的按钮
 * 切换（见 DarkroomView 的 addAction）。其余状态都在游戏自己的存档里。
 */
export interface DarkroomSettings {
  /** 界面语言代码。默认 "en" —— 即不套用任何翻译表，显示上游原文。 */
  language: string;
  /**
   * 紧凑模式：把库存与信息流两块面板外移到 Obsidian 的左右侧边栏，让游戏本体
   * 从 920px 收窄到 700px，避免视图较窄时两侧被裁。
   *
   * 默认关闭 —— 游戏本体始终留在主编辑区，这里只决定两块附属面板的归属。
   */
  compact: boolean;
}

export const DEFAULT_SETTINGS: DarkroomSettings = {
  language: "en",
  compact: false,
};
