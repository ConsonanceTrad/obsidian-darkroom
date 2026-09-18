import obsidianmd from "eslint-plugin-obsidianmd";

/**
 * 本地复现 Obsidian 社区插件审核用的同一套规则（eslint-plugin-obsidianmd）。
 *
 * 不参与 lint 的路径：
 *   · main.js / output/** —— esbuild 的构建产物；
 *   · src/game/generated/** —— 构建期生成的运行时（含随仓库分发的 adr.runtime.d.ts）；
 *   · src/game/upstream/** —— vendored 的上游 A Dark Room 源码，逐字节原样、MPL-2.0，
 *     其风格问题不属于本插件（改动它反而会破坏 "verbatim" 的可比对性）；
 *   · .tmp/** —— 本地临时目录。
 */
export default [
  {
    ignores: [
      "main.js",
      "output/**",
      "node_modules/**",
      "src/game/generated/**",
      "src/game/upstream/**",
      ".tmp/**",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    // 这套规则里有若干条（await-thenable 等）需要类型信息，必须指向仓库的 tsconfig。
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // src/game/runtime/** 是会被注入到拼接 IIFE 作用域里的代码片段（不是模块）：
    //   · 它们引用的 Engine / State / $ / $SM / __darkroomHost … 由宿主 IIFE 提供，
    //     片段自身无从声明，no-undef 在此没有意义；
    //   · 顶层那些声明（__setRoot / __setHost / AudioEngine …）正是给同一作用域里的
    //     其它片段用的，因此 no-unused-vars 同理；
    //   · storage-shim.js 刻意遮蔽 localStorage 并转发到插件持久层 —— 这正是
    //     no-restricted-globals 想推广的做法，规则在此不适用。
    files: ["src/game/runtime/**/*.js"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-restricted-globals": "off",
    },
  },
  {
    // 这两处 UI 文本 "A Dark Room" 是上游游戏的产品正式名，不属于普通句子，
    // 不应按 sentence case 改写（用 eslint-disable 注释会被规则集的
    // eslint-comments/no-restricted-disable 拦下，故在此按文件关掉该规则）。
    files: ["src/main.ts", "src/view/DarkroomView.ts"],
    rules: {
      "obsidianmd/ui/sentence-case": "off",
    },
  },
];
