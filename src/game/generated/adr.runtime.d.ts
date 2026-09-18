/*
 * 自动生成，请勿手工编辑 —— 生成器：scripts/build-game.mjs
 * 内含 A Dark Room（MPL-2.0，© Michael Townsend / Doublespeak Games）。
 */
export interface DarkroomHost {
  /** 同步读取全部持久化键值；返回 undefined 表示尚无存档。 */
  load(): Record<string, string> | undefined;
  /** 持久化当前的键值快照（实现方应自行节流）。 */
  save(state: Record<string, string>): void;
  /** 清空持久化数据。 */
  clear(): void;
  /** 游戏想把标题设为 title（上游会写 document.title）。 */
  setTitle(title: string): void;
  /** 读取上一个标题。 */
  getTitle(): string;
  /** 游戏的里程碑埋点（Engine.event(cat, act)）。 */
  gameEvent(cat: string, act: string): void;
  /** 游戏导入了一份新存档并已写入存储桥，宿主应据此重建运行时。 */
  importSave(saveData: string): void;
  /** 游戏内的"重启"：存档已清空，宿主应据此重建运行时（上游此处是 location.reload()）。 */
  saveCleared(): void;
  /** 游戏内语言菜单被点击（Engine.switchLanguage 转发）。宿主应换翻译表并重建视图。 */
  switchLanguage(lang: string): void;
  /** 游戏想打开一个外部链接（github 菜单项；Electron 下须由宿主交给系统浏览器）。 */
  openExternal(url: string): void;
}

export interface DarkroomRuntime {
  setHost(host: Partial<DarkroomHost>): void;
  setRoot(el: HTMLElement): void;
  boot(options?: Record<string, unknown>): unknown;
  /** 切换界面语言（已随包登记的语言名；无对应表则回落英文原文）。 */
  setLanguage(name: string): boolean;
  /** 已随包登记的语言代码列表（不含英文 —— 英文是原文，无需翻译表）。 */
  getLanguages(): string[];
  /** 立即落盘当前存档。 */
  save(): void;
  /** 停止本实例的一切计时活动；此后该实例不可再用。 */
  dispose(): void;
  /** 上游 Engine 对象 —— 本移植只用到开关灯（主题同步）与语言切换。 */
  Engine: {
    isLightsOff?: () => boolean;
    turnLightsOff?: () => void;
    switchLanguage?: (lang: string) => void;
    [key: string]: unknown;
  };
  /** 上游 StateManager（路径语法见 api/DarkroomAPI.ts 的 getState 注释）。 */
  $SM: {
    get(path: string, requestZero?: boolean): unknown;
    set(path: string, value: unknown): void;
    add(path: string, delta: number): void;
    [key: string]: unknown;
  };
  /** 上游事件总线：Dispatch(name).subscribe(cb)。 */
  $: {
    Dispatch(name: string): { subscribe(callback: (payload?: unknown) => void): unknown };
    [key: string]: unknown;
  };
  modules: Record<string, unknown>;
  getState(): unknown;
}

/** 工厂：每次调用都得到一套全新的、彼此隔离的游戏实例。
 *
 * @param locale 初始界面语言（如 "zh_cn"；英文传 "en" 或省略）。
 *   必须在**工厂调用时**传入而非事后 setLanguage —— 上游有 234 处模块级 _() 调用
 *   在脚本加载时就求值了，晚于此刻的切换不会反映到那些常量上。 */
export default function createDarkroomRuntime(locale?: string): DarkroomRuntime;
