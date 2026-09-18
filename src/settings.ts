import { App, PluginSettingTab, Setting } from "obsidian";
import type DarkroomPlugin from "./main";

export interface DarkroomSettings {
  /** 打开游戏时放在右侧边栏，而不是主工作区的新标签页。 */
  openInSidebar: boolean;
}

export const DEFAULT_SETTINGS: DarkroomSettings = {
  openInSidebar: false,
};

export class DarkroomSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: DarkroomPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("默认打开位置")
      .setDesc("关闭时在主工作区新标签页打开；开启时放在右侧边栏。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openInSidebar).onChange(async (value) => {
          this.plugin.settings.openInSidebar = value;
          await this.plugin.saveSettings();
        })
      );

    this.renderAbout(containerEl);
  }

  /** 关于区块：把来源与许可直接放在设置面板里，而不只是躺在仓库文件中。 */
  private renderAbout(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("关于").setHeading();

    containerEl.createEl("p", {
      text: "本插件是 A Dark Room 的 Obsidian 移植版，游戏本体并非本插件作者原创。",
    });

    const info = containerEl.createEl("table");
    const rows: Array<[string, string]> = [
      ["原作", "A Dark Room — A Minimalist Text Adventure"],
      ["作者 / 版权", "Michael Townsend / Doublespeak Games"],
      ["上游仓库", "https://github.com/doublespeakgames/adarkroom"],
      ["固定提交", "1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7（上游 v1.4）"],
      ["原作许可", "Mozilla Public License 2.0 (MPL-2.0)"],
      ["本插件代码", "MIT（仅适配层；不改变上游各文件的 MPL-2.0 状态）"],
    ];
    for (const [key, value] of rows) {
      const tr = info.createEl("tr");
      tr.createEl("th", { text: key });
      tr.createEl("td", { text: value });
    }

    containerEl.createEl("p", {
      text: "上游源码随本插件仓库完整分发于 src/game/upstream/，且逐字节未作修改；本移植对原作的全部改动都发生在构建期，并逐条登记在 src/game/upstream.meta.json 的 buildTimeTransforms 中。",
    });

    containerEl.createEl("p", {
      text: "本移植与 Doublespeak Games 无隶属或背书关系。本版本为静音版（不包含原作音效与配乐），界面仅提供简体中文。",
    });

    new Setting(containerEl)
      .setName("查看完整来源与改动说明")
      .setDesc("THIRD_PARTY_NOTICES.md —— 含来源 URL、固定提交、逐条构建期改动、第三方库许可（jQuery 等）")
      .addButton((button) =>
        button.setButtonText("打开").onClick(() => {
          void this.app.workspace.openLinkText("THIRD_PARTY_NOTICES.md", "", true);
        })
      )
      .addButton((button) =>
        button.setButtonText("MPL-2.0 全文").onClick(() => {
          void this.app.workspace.openLinkText("LICENSE-ADARKROOM.md", "", true);
        })
      );
  }
}
