import type DarkroomPlugin from "../main";
import type { DarkroomRuntime } from "../game/generated/adr.runtime.js";

/** 里程碑事件：对应上游 Engine.event(cat, act) 的发出点。 */
export interface DarkroomGameEvent {
  category: string;
  action: string;
}

/** 状态变更：对应上游 StateManager 的 stateUpdate 广播。 */
export interface DarkroomStateChange {
  category?: string;
  stateName?: string;
}

export type DarkroomEventHandler = (payload?: unknown) => void;

/**
 * 对外 API —— 让其它插件能够驱动或观察这个游戏。
 *
 * 取用方式（在别的插件里）：
 *   const darkroom = (this.app as any).plugins.plugins["darkroom"]?.api;
 *   darkroom?.on("game-event", (e) => ...);   // e: { category, action }
 *   darkroom?.getState<number>("stores.wood");
 *
 * 也可以直接订阅 Obsidian 工作区事件（无需拿到实例）：
 *   this.registerEvent(this.app.workspace.on("darkroom:game-event", (e) => ...));
 *
 * 可用事件名：opened / closed / state-changed / game-event
 */
export class DarkroomAPI {
  constructor(private readonly plugin: DarkroomPlugin) {}

  /** 打开游戏视图；已经打开则聚焦。 */
  open(): Promise<void> {
    return this.plugin.openGame();
  }

  /** 游戏视图当前是否挂载（视图关闭时运行时会一并销毁）。 */
  isOpen(): boolean {
    return this.plugin.getRuntime() !== null;
  }

  /**
   * 读取游戏状态。path 用的是上游 StateManager 的路径语法：
   *   "stores.wood"、'stores["alien alloy"]'、'game.buildings["trap"]'
   * 第二个参数对应上游的 requestZero：为 true 时，路径不存在会返回 0 而不是 undefined。
   */
  getState<T = unknown>(path: string, requestZero = false): T | undefined {
    const runtime = this.plugin.getRuntime();
    if (!runtime) {
      return undefined;
    }
    return runtime.$SM.get(path, requestZero) as T;
  }

  /** 写入游戏状态（会触发游戏自身的 UI 刷新）。返回是否成功。 */
  setState(path: string, value: unknown): boolean {
    const runtime = this.plugin.getRuntime();
    if (!runtime) {
      return false;
    }
    runtime.$SM.set(path, value);
    return true;
  }

  /** 对数值状态做累加。返回是否成功。 */
  addState(path: string, delta: number): boolean {
    const runtime = this.plugin.getRuntime();
    if (!runtime) {
      return false;
    }
    runtime.$SM.add(path, delta);
    return true;
  }

  /** 立即把当前存档落盘（平时由节流写入负责）。 */
  save(): void {
    this.plugin.getRuntime()?.save();
  }

  /** 清空存档并重开一局。 */
  reset(): void {
    this.plugin.resetGame();
  }

  /** 订阅事件。返回取消订阅的函数。 */
  on(event: string, handler: DarkroomEventHandler): () => void {
    return this.plugin.on(event, handler);
  }

  /** 取消订阅。 */
  off(event: string, handler: DarkroomEventHandler): void {
    this.plugin.off(event, handler);
  }

  /**
   * 直接取用运行时实例（逃生舱口 —— 需要上游模块时可以经它访问）。
   * 视图未打开时为 null；不要长期持有这个引用，运行时会随视图销毁而重建。
   */
  getRuntime(): DarkroomRuntime | null {
    return this.plugin.getRuntime();
  }
}
