# Darkroom

> 把 [**A Dark Room**](https://github.com/doublespeakgames/adarkroom) —— 一款极简文字冒险游戏 —— 搬进 Obsidian 的移植版。

---

## ⚠️ 来源与许可

**本插件不是原创游戏。** 它是一个移植版本，游戏本体由他人创作，请务必知悉以下归属：

| | |
| --- | --- |
| 原作 | **A Dark Room — A Minimalist Text Adventure** |
| 作者 / 版权 | **Michael Townsend / Doublespeak Games** |
| 上游仓库 | https://github.com/doublespeakgames/adarkroom |
| 固定提交 | `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`（上游 v1.4） |
| **原作许可** | **Mozilla Public License 2.0 (MPL-2.0)** — 全文见 [`LICENSE-ADARKROOM.md`](./LICENSE-ADARKROOM.md) |
| 本插件适配层许可 | MIT — 见 [`LICENSE`](./LICENSE) |
| 完整来源与改动说明 | [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) |

上游源码**随本仓库完整分发**于 [`src/game/upstream/`](./src/game/upstream)，且逐字节未作修改 —— 这满足 MPL-2.0 §3.2 的源码可得性要求。本插件对原作的全部改动都发生在构建期，只作用于生成物，并逐条登记在 [`src/game/upstream.meta.json`](./src/game/upstream.meta.json) 的 `buildTimeTransforms` 中。

本移植与 Doublespeak Games 无隶属或背书关系。"A Dark Room" 的名称与内容归其原作者所有。

---

## 这是什么

A Dark Room 从一团将熄的火焰开始。你在黑暗中生起火，有人循光而来；你派他们外出拾荒，建起村庄，然后走进外面那个空无一物的世界。它几乎没有画面 —— 全靠文字、留白与节奏。

本插件把它做成 Obsidian 内的一个原生视图，而不是内嵌网页：游戏直接渲染在 Obsidian 的 DOM 里，与插件生命周期、存档和命令面板打通，并提供对外 API 供其他插件联动。

**本移植为静音版**（不包含原作的音效与配乐），界面为**简体中文**。

## 安装

手动安装：

1. 构建产物（或下载发布的压缩包），把 `main.js`、`styles.css`、`manifest.json` 放进
   `<你的 vault>/.obsidian/plugins/obsidian-darkroom/`
2. 在 Obsidian 的「设置 → 第三方插件」中启用 **Darkroom**

## 使用

- 命令面板：**打开 A Dark Room**
- 游戏进度自动保存，存档随 vault 同步
- 游戏内的「保存」菜单可导出/导入存档代码

## 开发

```bash
npm install
npm run dev        # 监听并增量构建
npm run build      # 生产构建，产物在 output/
npm run typecheck  # 类型检查
```

`npm run build` 会先执行构建期代码生成（解析上游 `index.html`、拼接脚本、作用域化 CSS），
再交给 esbuild 打包。

### 目录结构

```
src/
  main.ts                 插件入口
  game/
    upstream/             A Dark Room 上游源码（原样保留，MPL-2.0）
    upstream.meta.json    来源、搬运/排除清单、构建期改动登记
    generated/            构建期生成的产物（不入库）
scripts/                  构建期代码生成脚本
docs/                     对外 API 文档
```

## 许可

- 本插件的适配层代码：**MIT**（[`LICENSE`](./LICENSE)）
- `src/game/upstream/**`（A Dark Room 上游代码及随包第三方库）：**MPL-2.0** 及其他各自声明的许可（[`LICENSE-ADARKROOM.md`](./LICENSE-ADARKROOM.md)、[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)）
