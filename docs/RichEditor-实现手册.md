# 富文本编辑器（RichEditor）功能实现手册

> 本手册基于 `src/components/design/RichEditor/` 的真实实现，逐文件、逐功能点拆解实现原理与完整代码，并附详细注释。读完本手册即可在任意 React + Tiptap v3 项目中复刻一个功能等价的富文本编辑器。
>
> 阅读顺序建议：从第 1 章到第 14 章顺序阅读，每一章对应一个功能模块，前面的模块是后面模块的依赖。
>
> 技术栈：React 19 + Tiptap v3.28 + Tailwind CSS v4 + radix-ui + lucide-react + lowlight。

---

## 目录

1. [整体架构与目录结构](#1-整体架构与目录结构)
2. [依赖安装与版本基线](#2-依赖安装与版本基线)
3. [类型契约 types.ts](#3-类型契约-typests)
4. [国际化文案 locale.ts](#4-国际化文案-localets)
5. [样式系统 styles.css](#5-样式系统-stylescss)
6. [标题节点 TitleNode（自定义 Node + NodeView）](#6-标题节点-titlenode自定义-node--nodeview)
7. [标题外观 NoteTitleField（受控输入 + IME 兼容）](#7-标题外观-notetitlefield受控输入--ime-兼容)
8. [空段落删除扩展 EmptyParagraphDelete](#8-空段落删除扩展-emptyparagraphdelete)
9. [图片处理 image.ts（选图 / 粘贴 / 拖放 / 格式归一）](#9-图片处理-imagets选图--粘贴--拖放--格式归一)
10. [图片上传扩展 ImageUpload.ts](#10-图片上传扩展-imageuploadts)
11. [链接处理 linkRange.ts + LinkForm.tsx](#11-链接处理-linkrangets--linkformtsx)
12. [代码语言配置 code/languages.ts](#12-代码语言配置-codelanguagests)
13. [扩展组装 extensions/index.ts（含 TabIndent / CustomDocument）](#13-扩展组装-extensionsindexts含-tabindent--customdocument)
14. [工具栏 Toolbar.tsx（响应式溢出 + 状态订阅）](#14-工具栏-toolbartsx响应式溢出--状态订阅)
15. [选区气泡菜单 FormatBubble.tsx](#15-选区气泡菜单-formatbubbletsx)
16. [主组件 RichEditor/index.tsx（编排一切）](#16-主组件-richeditorindexts编排一切)
17. [完整使用示例](#17-完整使用示例)
18. [验收清单](#18-验收清单)

---

## 1. 整体架构与目录结构

### 1.1 设计目标

这个富文本编辑器是基于 [Tiptap v3](https://tiptap.dev) 的二次封装，目标是提供：

- **开箱即用的笔记编辑体验**：内置常驻标题节点、占位符、字数统计、RTL 支持。
- **完整的格式能力**：粗体/斜体/下划线/删除线/行内代码/高亮、H1-H5 标题、有序/无序/任务列表、引用、代码块（语法高亮）、对齐、分隔线、表格、链接、图片。
- **本地图片三入口**：工具栏选图、粘贴、拖放，统一走 `onUploadImage` 钩子（默认转 base64 data URL，可在 Tauri/桌面端直接落盘）。
- **可扩展**：通过 `extensions` / `extraExtensions` / `toolbarExtra` 三个口子让业务自定义。
- **长文兼容**：通过 `renderBody` 与 `showTitle=false` 支持外层虚拟滚动（见第 17 章使用示例）。
- **中文优先**：默认中文文案，CJK 字数统计。

### 1.2 目录树

```
src/components/design/RichEditor/
├── index.tsx              # 主组件 RichEditor：编排扩展 / 工具栏 / 气泡 / 字数 / 受控同步
├── types.ts               # 对外 Props 与扩展选项类型
├── locale.ts              # 中英文案 + locale 合并工具
├── styles.css             # 编辑器内容样式（.tiptap 内部）+ 工具栏/气泡/链接面板样式
├── code/
│   ├── index.ts           # 代码语言常量导出
│   └── languages.ts       # 支持的代码语言清单（label 中文友好）
├── extensions/
│   ├── index.ts           # createExtensions：组装所有默认扩展 + TabIndent + CustomDocument
│   └── EmptyParagraphDelete.ts  # 空段落 Backspace/Delete 修复扩展
├── image/
│   ├── index.ts           # 导出
│   ├── image.ts           # fileToDataUrl / pickImageFile / insertImages 等纯函数
│   └── ImageUpload.ts     # Tiptap Extension：拦截 paste/drop 插图
├── link/
│   ├── index.ts           # 导出
│   ├── linkRange.ts       # resolveLinkTarget / applyLinkToRange 等选区工具
│   └── LinkForm.tsx       # 链接输入面板 + useLinkEditor 状态机
├── title/
│   ├── index.ts           # 导出
│   ├── TitleNode.ts       # 自定义 Node：atom 标题 + appendTransaction 结构修复 + Mod-a
│   ├── Title.tsx          # NodeView：用 NoteTitleField 渲染标题
│   └── NoteTitleField.tsx # 标题外观（徽章 + Input + 字数），独立可复用
└── toolbar/
    ├── index.ts           # 导出
    ├── Toolbar.tsx        # 顶部工具栏：响应式溢出 + 状态订阅 + 全部按钮
    └── FormatBubble.tsx   # 选区气泡：常用行内格式
```

### 1.3 数据流总览

```
                    ┌─────────────────────────────────────────────┐
   props.content ──►│                                             │
   props.onChange ◄─┤            RichEditor (index.tsx)             │
                    │  ┌──────────────────────────────────────┐  │
                    │  │ useEditor({ extensions, content, ... })│  │
                    │  │   - onCreate: 焦点钉到正文末尾          │  │
                    │  │   - onUpdate: 回调 { html, text, title }│  │
                    │  └──────────────────────────────────────┘  │
                    │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
                    │  │ Toolbar  │  │BubbleMenu│  │ LinkForm  │  │
                    │  │ (顶部)   │  │ (选区)   │  │ (链接草稿)│  │
                    │  └──────────┘  └──────────┘  └───────────┘  │
                    │  ┌──────────────────────────────────────┐  │
                    │  │ ScrollArea > EditorContent            │  │
                    │  │   渲染: title 节点 + 正文块           │  │
                    │  └──────────────────────────────────────┘  │
                    │  ┌──────────┐                              │
                    │  │CharCount │ (底部字数)                  │  │
                    │  └──────────┘                              │
                    └─────────────────────────────────────────────┘
```

关键点：

- `useEditor` 只在挂载时读一次 `extensions` 与 `content`，后续 props 变化靠 ref + effect 同步，避免每次渲染重建编辑器。
- `onUpdate` 是热路径，**不调用 `getJSON()`**（序列化开销大），只回传 `html` / `text` / `title`。
- 标题节点是 **atom**（不可在 ProseMirror 内直接编辑文本），通过 React NodeView 接管输入并写回 `attrs.value`。

---

## 2. 依赖安装与版本基线

`package.json` 中与编辑器相关的依赖（版本仅供参考，锁版本可避免 v2/v3 API 差异）：

```json
{
  "dependencies": {
    "@tiptap/core": "^3.28.0",
    "@tiptap/extension-code-block-lowlight": "^3.28.0",
    "@tiptap/extension-document": "^3.28.0",
    "@tiptap/extension-highlight": "^3.28.0",
    "@tiptap/extension-image": "^3.28.0",
    "@tiptap/extension-list": "^3.28.0",
    "@tiptap/extension-placeholder": "^3.28.0",
    "@tiptap/extension-table": "^3.28.0",
    "@tiptap/extension-text-align": "^3.28.0",
    "@tiptap/extensions": "^3.28.0",
    "@tiptap/pm": "^3.28.0",
    "@tiptap/react": "^3.28.0",
    "@tiptap/starter-kit": "^3.28.0",
    "lowlight": "^3.3.0",
    "lucide-react": "^0.563.0",
    "radix-ui": "^1.4.3",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-slot": "^1.2.4",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.4.0",
    "class-variance-authority": "^0.7.1"
  }
}
```

安装命令（一行装齐）：

```bash
npm install @tiptap/react @tiptap/pm @tiptap/core @tiptap/starter-kit \
  @tiptap/extension-document @tiptap/extension-placeholder \
  @tiptap/extension-image @tiptap/extension-highlight \
  @tiptap/extension-table @tiptap/extension-text-align \
  @tiptap/extension-list @tiptap/extension-code-block-lowlight \
  @tiptap/extensions lowlight lucide-react \
  radix-ui @radix-ui/react-scroll-area @radix-ui/react-slot \
  clsx tailwind-merge class-variance-authority
```

> **为什么用 Tiptap v3 而不是 v2？** v3 把 `Link`、`Underline`、`ListKeymap`、`TrailingNode` 合进 StarterKit；BubbleMenu 底层从 tippy.js 换成 Floating UI，定位更稳；还内置了 `CharacterCount` 的 `Segmenter` 友好 API。本手册所有 API 都基于 v3。

---

## 3. 类型契约 types.ts

类型文件是组件对外的「契约」，先定义清楚再写实现，能避免后续返工。

```ts
// src/components/design/RichEditor/types.ts
import type { Editor, Extensions, JSONContent } from '@tiptap/react';
import type { ReactNode, UIEventHandler } from 'react';
import type { ResolveImageSrc } from './image';
import type { RichEditorLocale } from './locale';

// 文本方向：auto 让浏览器根据内容判断 RTL（阿拉伯语/希伯来语）
export type TextDirection = 'ltr' | 'rtl' | 'auto';

// 内容支持 HTML 字符串或 Tiptap JSON
export type RichEditorContent = string | JSONContent;

// onChange 回调的载荷：热路径不返回 json（序列化贵）
export type RichEditorChangePayload = {
  html: string;
  /** 按需；热路径默认不序列化 JSON */
  json?: JSONContent;
  text: string;
  /** 文档首位 title 节点纯文本 */
  title: string;
};

// createExtensions 的选项：控制默认扩展的行为
export type CreateExtensionsOptions = {
  placeholder?: string;
  /** CharacterCount 上限；不传则只统计不限制 */
  maxLength?: number;
  /** 为 false 时不挂 CharacterCount（无字数 UI 且无上限时关掉，避免每键 Segmenter） */
  characterCount?: boolean;
  /** 粘贴/拖放图片解析（默认 FileReader → data URL） */
  resolveImageSrcRef?: { current: ResolveImageSrc };
  /** 追加扩展（在默认扩展之后） */
  extraExtensions?: Extensions;
  /** 完全替换默认扩展列表 */
  extensions?: Extensions;
  /** 是否显示笔记标题节点（默认 true） */
  showTitle?: boolean;
  /** 图片拖拽缩放（默认 false：长文下 NodeView/监听开销大） */
  imageResize?: boolean;
  /** 表格列宽拖拽（默认 false：同上） */
  tableResizable?: boolean;
};

// 主组件 Props
export type RichEditorProps = {
  /** 受控内容（HTML 或 JSON） */
  content?: RichEditorContent;
  /** 非受控初始内容 */
  defaultContent?: RichEditorContent;
  onChange?: (payload: RichEditorChangePayload) => void;
  editable?: boolean;
  autofocus?: boolean | 'start' | 'end' | 'all' | number;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  /** 字数上限（长文 CharacterCount） */
  maxLength?: number;
  /** 默认文本方向；默认 auto 以支持 RTL */
  textDirection?: TextDirection;
  showToolbar?: boolean;
  showBubbleMenu?: boolean;
  showCharCount?: boolean;
  /** 是否显示笔记标题节点（默认 true） */
  showTitle?: boolean;
  /** 图片拖拽缩放（默认 false） */
  imageResize?: boolean;
  /** 表格列宽拖拽（默认 false） */
  tableResizable?: boolean;
  /** 覆盖 / 合并文案（默认中文） */
  locale?: Partial<RichEditorLocale>;
  /** 完全替换默认扩展 */
  extensions?: Extensions;
  /** 在默认扩展后追加 */
  extraExtensions?: Extensions;
  /** 工具栏尾部插槽，便于业务扩展 */
  toolbarExtra?: ReactNode | ((editor: Editor) => ReactNode);
  /**
   * 自定义图片上传：工具栏选图 / 粘贴 / 拖放都会走这里。
   * 不传则本地读成 base64 data URL（Tauri 桌面端可用）。
   */
  onUploadImage?: ResolveImageSrc;
  onCreate?: (editor: Editor) => void;
  /** 正文 ScrollArea 滚动 */
  onBodyScroll?: UIEventHandler<HTMLDivElement>;
  /** 自定义包裹 EditorContent（长文外层虚拟滚动用） */
  renderBody?: (editorContent: ReactNode) => ReactNode;
};
```

### 3.1 实现要点

- **`RichEditorChangePayload.json` 是可选的**：默认 `onUpdate` 不调用 `getJSON()`，避免长文每键序列化。需要 JSON 时由调用方在 `onChange` 内自行 `editor.getJSON()`（受控语义下）。
- **`showTitle` 双向控制**：既影响 `createExtensions`（是否挂 `TitleNode` + `CustomDocument`），又影响 `content` 归一化（是否套 `EMPTY_NOTE_DOC`），还影响 `autofocus` 行为。
- **`resolveImageSrcRef` 用 ref 而不是函数**：Tiptap 的 `useEditor` 只在挂载时读一次 extensions，把可变上传逻辑放在 ref 里，props 变化时无需重建编辑器（见第 10 章）。

---

## 4. 国际化文案 locale.ts

文案集中管理，便于做中英文切换或部分覆盖。

```ts
// src/components/design/RichEditor/locale.ts

/** 富文本编辑器中文文案（默认语言） */
export const zhCN = {
  placeholder: '开始输入…',
  placeholderHeadingHint: '请输入笔记标题',
  placeholderHeading: '标题',
  bold: '粗体',
  italic: '斜体',
  underline: '下划线',
  strike: '删除线',
  code: '行内代码',
  highlight: '高亮',
  h1: '一级标题',
  h2: '二级标题',
  h3: '三级标题',
  h4: '四级标题',
  h5: '五级标题',
  bulletList: '无序列表',
  orderedList: '有序列表',
  taskList: '任务列表',
  blockquote: '引用',
  codeBlock: '代码块',
  codeLanguage: '代码语言',
  horizontalRule: '分隔线',
  alignLeft: '左对齐',
  alignCenter: '居中',
  alignRight: '右对齐',
  alignJustify: '两端对齐',
  dirLtr: '从左到右',
  dirRtl: '从右到左',
  dirAuto: '自动方向',
  link: '链接',
  unlink: '移除链接',
  linkPrompt: '链接地址',
  linkPlaceholder: 'https://example.com',
  linkApply: '确定',
  linkCancel: '取消',
  linkEmptyHint: '请先选中文字，或将光标放在要加链接的内容上',
  image: '图片',
  imagePick: '选择本地图片',
  table: '插入表格',
  addColumnBefore: '左侧插入列',
  addColumnAfter: '右侧插入列',
  deleteColumn: '删除列',
  addRowBefore: '上方插入行',
  addRowAfter: '下方插入行',
  deleteRow: '删除行',
  mergeCells: '合并单元格',
  splitCell: '拆分单元格',
  deleteTable: '删除表格',
  undo: '撤销',
  redo: '重做',
  clearFormat: '清除格式',
  chars: '字符',
  words: '词',
  limitReached: '已达字数上限',
} as const;

// 英文：键必须与 zhCN 完全对齐
export const enUS: { [K in keyof typeof zhCN]: string } = {
  placeholder: 'Start typing…',
  placeholderHeadingHint: 'Enter note title',
  placeholderHeading: 'Title',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  code: 'Inline code',
  highlight: 'Highlight',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  bulletList: 'Bullet list',
  orderedList: 'Numbered list',
  taskList: 'Task list',
  blockquote: 'Quote',
  codeBlock: 'Code block',
  codeLanguage: 'Language',
  horizontalRule: 'Divider',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  alignJustify: 'Justify',
  dirLtr: 'Left to right',
  dirRtl: 'Right to left',
  dirAuto: 'Auto direction',
  link: 'Link',
  unlink: 'Remove link',
  linkPrompt: 'URL',
  linkPlaceholder: 'https://example.com',
  linkApply: 'Apply',
  linkCancel: 'Cancel',
  linkEmptyHint:
    'Select text first, or place the caret where the link should go',
  image: 'Image',
  imagePick: 'Choose image',
  table: 'Insert table',
  addColumnBefore: 'Insert column before',
  addColumnAfter: 'Insert column after',
  deleteColumn: 'Delete column',
  addRowBefore: 'Insert row above',
  addRowAfter: 'Insert row below',
  deleteRow: 'Delete row',
  mergeCells: 'Merge cells',
  splitCell: 'Split cell',
  deleteTable: 'Delete table',
  undo: 'Undo',
  redo: 'Redo',
  clearFormat: 'Clear formatting',
  chars: 'chars',
  words: 'words',
  limitReached: 'Character limit reached',
};

// 类型：所有 key 都是 string
export type RichEditorLocale = { [K in keyof typeof zhCN]: string };
export type LocaleKey = keyof RichEditorLocale;

/** 根据应用级 locale 取编辑器文案 */
export function richEditorLocaleOf(
  appLocale: 'zh-CN' | 'en-US',
): RichEditorLocale {
  return appLocale === 'en-US' ? enUS : zhCN;
}
```

### 4.1 实现要点

- 用 `as const` 锁定 `zhCN` 的键集合，再用 `enUS: { [K in keyof typeof zhCN]: string }` 强制英文键与中文一一对应，**漏译会编译报错**。
- `RichEditorProps.locale` 是 `Partial<RichEditorLocale>`，业务只需传想覆盖的键，其余走中文默认（见第 16 章 `mergeLocale`）。

---

## 5. 样式系统 styles.css

Tiptap 是 headless 的，节点本身没有样式，必须自己写。这里把所有编辑器内样式集中在一个 CSS 文件，用 CSS 变量对接主题（`--theme-color` / `--theme-border` / `--theme-textcolor` / `--theme-background`），不写死颜色。

```css
/* src/components/design/RichEditor/styles.css */

/* ====== 容器骨架 ====== */
.rich-editor {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

/* ====== 工具栏 ====== */
.rich-editor-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.125rem;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
  z-index: 1;
}

/* 隐形测量行：与真实按钮同构，用于算每项宽度（见第 14 章） */
.rich-editor-toolbar-measure {
  position: absolute;
  left: -9999px;
  top: 0;
  visibility: hidden;
  pointer-events: none;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  white-space: nowrap;
}

.rich-editor-toolbar-start {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.rich-editor-toolbar-main {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  min-width: 0;
  /* 不抢剩余空间，让 More 紧跟最后一个可见按钮 */
  flex: 0 1 auto;
  overflow: hidden;
}

.rich-editor-toolbar-more {
  flex-shrink: 0;
}

.rich-editor-toolbar-extra {
  display: flex;
  align-items: center;
  margin-left: 0.25rem;
  flex-shrink: 0;
}

.rich-editor-toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  flex-shrink: 0;
}

.rich-editor-toolbar-sep {
  width: 1px;
  height: 1.25rem;
  margin: 0 0.25rem;
  background: var(--theme-border, var(--border));
}

/* ====== 按钮 ====== */
.rich-editor-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.75;
}

.rich-editor-btn:hover:not(:disabled) {
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 10%,
    transparent
  );
  opacity: 1;
}

/* 激活态：当前光标所在节点已应用该格式 */
.rich-editor-btn.is-active {
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 18%,
    transparent
  );
  opacity: 1;
}

.rich-editor-btn:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

/* ====== 正文区域 ====== */
.rich-editor-body {
  flex: 1 1 auto;
  min-height: 0;
  /* 滚动由 ScrollArea 接管，与左侧列表滚动条一致 */
  padding: 0.75rem;
  font-size: 16px;
}

.rich-editor-body .tiptap {
  outline: none;
  min-height: 8rem;
}

/* 文本选区高亮：用主题色 alpha */
.rich-editor-body .tiptap ::selection {
  background-color: var(
    --theme-selection-bg,
    color-mix(
      in oklab,
      var(--theme-color, oklch(0.55 0.18 250)) 42%,
      transparent
    )
  );
  color: var(--theme-selection-fg, inherit);
}

/* 段落 */
.rich-editor-body .tiptap p {
  line-height: 1.9;
}

/* 标题 H1-H5 */
.rich-editor-body .tiptap h1 {
  font-size: 1.8em;
  font-weight: 700;
  margin: 0.5em 0;
  line-height: 1.3;
}
.rich-editor-body .tiptap h2 {
  font-size: 1.7em;
  font-weight: 700;
  margin: 0.5em 0;
  line-height: 1.35;
}
.rich-editor-body .tiptap h3 {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.5em 0;
  line-height: 1.4;
}
.rich-editor-body .tiptap h4 {
  font-size: 1.35em;
  font-weight: 600;
  margin: 0.5em 0;
  line-height: 1.4;
}
.rich-editor-body .tiptap h5 {
  font-size: 1.2em;
  font-weight: 600;
  margin: 0.5em 0;
  line-height: 1.45;
}

/* 列表 */
.rich-editor-body .tiptap ul,
.rich-editor-body .tiptap ol {
  padding-left: 1.5em;
}

/* 引用 */
.rich-editor-body .tiptap blockquote {
  border-left: 3px solid var(--theme-border, var(--border));
  padding-left: 1em;
  opacity: 0.8;
}

/* 代码块 */
.rich-editor-body .tiptap pre {
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 8%,
    transparent
  );
  color: var(--theme-textcolor);
  border-radius: 0.5rem;
  padding: 0.75em 1em;
  margin: 0.6em 0;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875em;
}

/* 行内代码 */
.rich-editor-body .tiptap code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875em;
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 10%,
    transparent
  );
}

.rich-editor-body .tiptap pre code {
  padding: 0;
  background: none;
  color: inherit;
}

/* 链接 */
.rich-editor-body .tiptap a {
  color: var(--theme-color, var(--primary));
  text-decoration: underline;
  cursor: pointer;
}

/* 图片 */
.rich-editor-body .tiptap img,
.rich-editor-body .tiptap .rich-editor-image {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  display: block;
  margin: 0.75em 0;
}

/* 块级图片前后的间隙光标（点进图前/图后） */
.rich-editor-body .tiptap .ProseMirror-gapcursor {
  display: none;
  pointer-events: none;
  position: absolute;
}
.rich-editor-body .tiptap .ProseMirror-gapcursor::after {
  content: '';
  display: block;
  position: absolute;
  top: -2px;
  width: 20px;
  border-top: 1px solid var(--theme-textcolor, var(--foreground));
  animation: rich-editor-gapcursor-blink 1.1s steps(2, start) infinite;
}
@keyframes rich-editor-gapcursor-blink {
  to {
    visibility: hidden;
  }
}

/* 分隔线 */
.rich-editor-body .tiptap hr {
  border: none;
  border-top: 1px solid var(--theme-border, var(--border));
  margin: 1.25em 0;
}

/* 高亮标记 */
.rich-editor-body .tiptap mark {
  background-color: #fef08a;
  border-radius: 0.15em;
  padding: 0.05em 0.15em;
}

/* ====== 表格 ====== */
.rich-editor-body .tiptap table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
  table-layout: fixed;
  overflow: hidden;
}

.rich-editor-body .tiptap table td,
.rich-editor-body .tiptap table th {
  border: 1px solid var(--theme-border, var(--border));
  padding: 0.4em 0.6em;
  vertical-align: top;
  min-width: 3em;
  position: relative;
}

.rich-editor-body .tiptap table th {
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 8%,
    transparent
  );
  font-weight: 600;
  text-align: left;
}

/* 选中单元格高亮 */
.rich-editor-body .tiptap .selectedCell::after {
  content: "";
  position: absolute;
  inset: 0;
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 12%,
    transparent
  );
  pointer-events: none;
  z-index: 1;
}

/* 列宽拖拽手柄（tableResizable 开启时） */
.rich-editor-body .tiptap .column-resize-handle {
  position: absolute;
  right: -1px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--theme-color, var(--primary));
  pointer-events: none;
}

/* ====== 任务列表 ====== */
.rich-editor-body .tiptap ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
}

.rich-editor-body .tiptap ul[data-type="taskList"] li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.rich-editor-body .tiptap ul[data-type="taskList"] li > label {
  flex-shrink: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rich-editor-body .tiptap ul[data-type="taskList"] li > div {
  flex: 1;
  min-width: 0;
}

/* ====== 占位符 ====== */
/* is-editor-empty: 整个编辑器空；is-empty: 单个块空 */
.rich-editor-body .tiptap p.is-editor-empty:first-child::before,
.rich-editor-body .tiptap .is-empty:not(.rich-editor-note-title)::before {
  color: color-mix(
    in oklab,
    var(--theme-textcolor, var(--foreground)) 40%,
    transparent
  );
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

/* ====== 底部字数栏 ====== */
.rich-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.35rem 0.75rem;
  border-top: 1px solid var(--theme-border, var(--border));
  font-size: 0.75rem;
  opacity: 0.55;
  flex-shrink: 0;
}

.rich-editor-footer.is-limit {
  color: var(--destructive, #dc2626);
  opacity: 1;
}

/* ====== 气泡菜单 ====== */
.rich-editor-bubble {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.125rem;
  padding: 0.25rem;
  border: 1px solid var(--theme-border, var(--border));
  border-radius: 0.5rem;
  background: var(--theme-background, var(--background));
  box-shadow: 0 4px 16px rgb(0 0 0 / 8%);
}

/* ====== 链接输入面板 ====== */
.rich-editor-link-form {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--theme-border, var(--border));
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 4%,
    transparent
  );
  flex-shrink: 0;
}

.rich-editor-link-label {
  font-size: 0.7rem;
  opacity: 0.65;
  white-space: nowrap;
}

.rich-editor-link-hint {
  flex-basis: 100%;
  font-size: 0.7rem;
  opacity: 0.65;
  color: var(--destructive, #dc2626);
}

.rich-editor-link-action {
  height: 1.75rem;
  padding: 0 0.55rem;
  border: none;
  border-radius: 0.375rem;
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 16%,
    transparent
  );
  color: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  white-space: nowrap;
}

.rich-editor-link-action:hover {
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 28%,
    transparent
  );
}

.rich-editor-link-action:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.rich-editor-link-action.ghost {
  background: transparent;
  opacity: 0.7;
}

.rich-editor-link-action.ghost:hover {
  opacity: 1;
  background: color-mix(
    in oklab,
    var(--theme-color, var(--primary)) 10%,
    transparent
  );
}

/* ====== 代码语言选择器 ====== */
.rich-editor-lang {
  height: 1.75rem;
  max-width: 7.5rem;
  margin-left: 0.125rem;
  padding: 0 0.35rem;
  border: 1px solid var(--theme-border, var(--border));
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  font-size: 0.7rem;
  cursor: pointer;
}

/* ====== highlight.js 代码高亮配色（VSCode 风格） ====== */
.rich-editor-body .tiptap pre .hljs-comment,
.rich-editor-body .tiptap pre .hljs-quote {
  color: #6a9955;
  font-style: italic;
}

.rich-editor-body .tiptap pre .hljs-keyword,
.rich-editor-body .tiptap pre .hljs-selector-tag,
.rich-editor-body .tiptap pre .hljs-built_in,
.rich-editor-body .tiptap pre .hljs-name,
.rich-editor-body .tiptap pre .hljs-tag {
  color: #c586c0;
}

.rich-editor-body .tiptap pre .hljs-string,
.rich-editor-body .tiptap pre .hljs-title,
.rich-editor-body .tiptap pre .hljs-section,
.rich-editor-body .tiptap pre .hljs-attribute,
.rich-editor-body .tiptap pre .hljs-literal,
.rich-editor-body .tiptap pre .hljs-template-tag,
.rich-editor-body .tiptap pre .hljs-template-variable,
.rich-editor-body .tiptap pre .hljs-type,
.rich-editor-body .tiptap pre .hljs-addition {
  color: #ce9178;
}

.rich-editor-body .tiptap pre .hljs-number,
.rich-editor-body .tiptap pre .hljs-selector-attr,
.rich-editor-body .tiptap pre .hljs-selector-pseudo,
.rich-editor-body .tiptap pre .hljs-variable,
.rich-editor-body .tiptap pre .hljs-template-variable,
.rich-editor-body .tiptap pre .hljs-attr,
.rich-editor-body .tiptap pre .hljs-literal {
  color: #b5cea8;
}

.rich-editor-body .tiptap pre .hljs-function,
.rich-editor-body .tiptap pre .hljs-title.function_,
.rich-editor-body .tiptap pre .hljs-title.function_ .hljs-params {
  color: #dcdcaa;
}

.rich-editor-body .tiptap pre .hljs-class .hljs-title,
.rich-editor-body .tiptap pre .hljs-class .hljs-title.function_ {
  color: #4ec9b0;
}

.rich-editor-body .tiptap pre .hljs-operator,
.rich-editor-body .tiptap pre .hljs-entity,
.rich-editor-body .tiptap pre .hljs-url,
.rich-editor-body .tiptap pre .hljs-attr {
  color: #d4d4d4;
}

.rich-editor-body .tiptap pre .hljs-symbol,
.rich-editor-body .tiptap pre .hljs-bullet,
.rich-editor-body .tiptap pre .hljs-link {
  color: #ce9178;
}

.rich-editor-body .tiptap pre .hljs-deletion,
.rich-editor-body .tiptap pre .hljs-meta {
  color: #808080;
}

.rich-editor-body .tiptap pre .hljs-meta .hljs-keyword,
.rich-editor-body .tiptap pre .hljs-meta .hljs-string {
  color: #cdcd00;
}
```

### 5.1 实现要点

- **主题变量优先**：所有颜色走 `var(--theme-xxx, var(--默认))`，外层切换主题时编辑器自动跟随。
- **`color-mix(in oklab, ...)`**：用 oklab 色彩空间混合，比 `rgba` 更自然，Safari 16.4+ 支持。
- **占位符 CSS** 必须配合 `Placeholder` 扩展的 `emptyEditorClass` / `emptyNodeClass` 使用（见第 13 章）。
- **`hljs-*` 配色** 是 VSCode Dark+ 风格，让代码块在浅色/深色主题下都易读。

---

## 6. 标题节点 TitleNode（自定义 Node + NodeView）

这是整个编辑器最复杂的部分。目标是让笔记拥有一个**常驻在文档首位、独立于正文的标题输入框**。

### 6.1 为什么不用普通 H1 当标题？

- 普通标题是 `block` group，可以出现在文档任意位置，无法强制「只能在首位且唯一」。
- 普通标题里的 `Mod-a` 会把标题一起选中，不利于「全选只选正文」。
- 想要标题用 React Input 渲染（带徽章、字数、IME 处理），需要 NodeView 接管。

### 6.2 方案：自定义 Document + Title Node

```ts
// src/components/design/RichEditor/title/TitleNode.ts
import type { Editor, JSONContent } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import TitleView from './Title';

/** 空笔记：必有 title + 一段正文，避免只有 atom 时光标落在 GapCursor 上无法输入 */
export const EMPTY_NOTE_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'title', attrs: { value: '' } }, { type: 'paragraph' }],
};

/** 空 HTML / 空串 → 合法笔记文档 */
export function normalizeNoteContent(
  content: string | JSONContent | undefined | null,
): string | JSONContent {
  // 空内容统一归一为 EMPTY_NOTE_DOC，保证文档结构合法
  if (content == null || content === '' || content === '<p></p>') {
    return EMPTY_NOTE_DOC;
  }
  return content;
}

/**
 * 笔记常驻标题：atom + 原生 input（attrs.value）。
 * group 不用 block，保证文档仅首位一个 title。
 *
 * 关键设计：
 * - atom: true → ProseMirror 把它当原子，不在内部做文本编辑
 * - group: 'title' → 与默认的 'block' group 隔离，配合 CustomDocument 的 content 约束
 * - selectable: false → 不能被选中成节点选区，避免 Mod-a 选中
 * - draggable: false → 不可拖拽
 */
export const TitleNode = Node.create({
  name: 'title',

  group: 'title',

  atom: true,

  draggable: false,

  selectable: false,

  // 标题的「内容」是 attrs.value，不是子节点
  addAttributes() {
    return {
      value: {
        default: '',
        // 从 HTML 解析：优先 data-value，其次 textContent
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute('data-value') ??
          (el as HTMLElement).textContent ??
          '',
        // 渲染到 HTML：空值不输出属性，减少噪音
        renderHTML: (attrs) =>
          attrs.value ? { 'data-value': attrs.value as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="note-title"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'note-title',
        'data-value': node.attrs.value ?? '',
      }),
      node.attrs.value ?? '',
    ];
  },

  // 用 React NodeView 渲染标题外观
  addNodeView() {
    // stopEvent: () => true → 标题内的鼠标/键盘事件不交给 ProseMirror，避免和正文抢输入
    return ReactNodeViewRenderer(TitleView, {
      stopEvent: () => true,
    });
  },

  // 核心结构修复插件：保证「仅首位一个 title + 至少一个正文块」
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('singleNoteTitle'),
        appendTransaction(transactions, _old, state) {
          // 只在文档变化或选区变化时介入
          const docChanged = transactions.some((tr) => tr.docChanged);
          const selectionSet = transactions.some((tr) => tr.selectionSet);
          if (!docChanged && !selectionSet) return null;

          let tr = state.tr;
          let changed = false;

          // === 结构修复：只在 doc 变化时做 ===
          if (docChanged) {
            // 1. 删除多余的 title（保留首位）
            const extras: { pos: number; nodeSize: number }[] = [];
            let seen = 0;
            state.doc.forEach((node, offset) => {
              if (node.type.name !== 'title') return;
              seen += 1;
              if (seen > 1)
                extras.push({ pos: offset, nodeSize: node.nodeSize });
            });
            // 从后往前删，避免 pos 偏移
            for (let i = extras.length - 1; i >= 0; i--) {
              const { pos, nodeSize } = extras[i];
              tr.replaceWith(
                pos,
                pos + nodeSize,
                state.schema.nodes.paragraph.create(),
              );
              changed = true;
            }

            // 2. 没有正文块时补一段（atom 旁 GapCursor 看起来像有光标但输不进字）
            const doc = changed ? tr.doc : state.doc;
            const title = doc.firstChild;
            if (title?.type.name === 'title' && doc.childCount < 2) {
              tr = tr.insert(
                title.nodeSize,
                state.schema.nodes.paragraph.create(),
              );
              changed = true;
            }
          }

          // === 选区修复：纠正非法选区 ===
          const nextDoc = changed ? tr.doc : state.doc;
          const titleNode = nextDoc.firstChild;
          if (titleNode?.type.name === 'title') {
            const titleSize = titleNode.nodeSize;
            const sel = changed ? tr.selection : state.selection;
            const $from = sel.$from;
            // 判断光标是否在正文（title 之后）的可编辑文本块里
            const caretInBody =
              sel instanceof TextSelection &&
              sel.empty &&
              $from.parent.isTextblock &&
              $from.pos > titleSize;

            // 「空正文」或非法非文本选区才纠正。
            // 正文里的 GapCursor（如图片前）合法——旧逻辑一律 atEnd，导致无法在图前输入。
            const bodyEmpty =
              nextDoc.childCount < 2 ||
              (nextDoc.childCount === 2 &&
                nextDoc.child(1).isTextblock &&
                nextDoc.child(1).content.size === 0);

            let needsFix = false;
            // 空正文且光标不在正文 → 钉到正文开头
            if (bodyEmpty && sel.empty && !caretInBody) {
              needsFix = true;
            } else if (
              // 非空正文但选区落在非文本块（如 atom 上）→ 钉到文末
              sel.empty &&
              !(sel instanceof GapCursor) &&
              !$from.parent.isTextblock
            ) {
              needsFix = true;
            }

            if (needsFix && titleSize + 1 <= nextDoc.content.size) {
              const nextSel = bodyEmpty
                ? TextSelection.create(nextDoc, titleSize + 1)
                : Selection.atEnd(nextDoc);
              tr = tr.setSelection(nextSel);
              changed = true;
            }
          }

          return changed ? tr : null;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      /** 全选只覆盖正文，避开 title NodeView，让浏览器能画出原生选区高亮 */
      'Mod-a': ({ editor }) => {
        const { doc } = editor.state;
        const title = doc.firstChild;
        if (title?.type.name !== 'title') return false;

        // 从 title 之后开始选
        const start = title.nodeSize + 1;
        if (start >= doc.content.size) return true;

        const from = TextSelection.near(doc.resolve(start), 1).from;
        const to = Selection.atEnd(doc).to;
        if (from < to) {
          editor.commands.setTextSelection({ from, to });
        } else {
          editor.commands.setTextSelection(from);
        }
        return true;
      },
    };
  },
});

export default TitleNode;

/** 取文档首位 title 文本，供笔记列表展示 */
export function getDocTitleText(doc: {
  firstChild?: {
    type: { name: string };
    attrs: Record<string, unknown>;
    textContent: string;
  } | null;
}): string {
  const first = doc.firstChild;
  if (first?.type.name !== 'title') return '';
  // 优先用 attr（NodeView 写入的值），兜底 textContent
  const fromAttr = first.attrs.value;
  if (typeof fromAttr === 'string') return fromAttr.trim();
  return first.textContent.trim();
}

/** 正文 Tab 缩进：列表下沉，否则插入 \t */
export function indentEditor(editor: Editor): boolean {
  if (editor.isActive('codeBlock')) return false;
  // 在列表里：下沉一级（变成子列表）
  if (editor.commands.sinkListItem('listItem')) return true;
  if (editor.commands.sinkListItem('taskItem')) return true;
  // 普通段落：插入制表符
  return editor.commands.insertContent('\t');
}

/** 标题 input 按 Enter / Tab：跳到正文末尾 */
export function focusAfterTitle(editor: Editor) {
  const title = editor.state.doc.firstChild;
  if (!title || title.type.name !== 'title') {
    editor.commands.focus('end');
    return;
  }
  const after = title.nodeSize;
  const next = editor.state.doc.nodeAt(after);
  // 标题后没有正文块：插入一个空段再聚焦
  if (!next) {
    editor
      .chain()
      .insertContentAt(after, { type: 'paragraph' })
      .focus('end')
      .run();
    return;
  }
  editor.commands.focus('end');
}
```

### 6.3 NodeView 包装层 Title.tsx

`TitleNode.addNodeView` 用 `ReactNodeViewRenderer(TitleView)` 把渲染交给 React。`TitleView` 是一个极薄的包装：

```tsx
// src/components/design/RichEditor/title/Title.tsx
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { NoteTitleField } from './NoteTitleField';
import { focusAfterTitle } from './TitleNode';

/**
 * TipTap 标题 NodeView：外观走 NoteTitleField，写入 attrs.value。
 *
 * NodeViewProps 提供：
 * - node: 当前 ProseMirror 节点（读 attrs.value）
 * - updateAttributes: 写回 attrs（标题变化时调用）
 * - editor: 编辑器实例（用于焦点切换）
 */
export default function TitleView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps) {
  return (
    // contentEditable={false}：标题容器本身不可被 ProseMirror 编辑
    <NodeViewWrapper as="div" contentEditable={false}>
      <NoteTitleField
        value={String(node.attrs.value ?? '')}
        onChange={(next) => updateAttributes({ value: next })}
        onContinue={() => focusAfterTitle(editor)}
      />
    </NodeViewWrapper>
  );
}
```

### 6.4 实现要点

- **`group: 'title'` 而非 `'block'`**：让 `CustomDocument` 的 `content: 'title block+'` 能精确约束「首位必须是 title，其后是若干 block」。如果用 `block`，普通段落也能放进首位，约束失效。
- **`atom: true` + `selectable: false`**：ProseMirror 不会在标题内做文本编辑，也不会把标题选成节点选区，键盘事件全交给 React Input。
- **`stopEvent: () => true`**：标题内的 `mousedown`/`keydown` 不冒泡到 ProseMirror 的 view，避免 ProseMirror 抢走 Input 的焦点。
- **`appendTransaction` 是结构守卫**：每次事务后扫描文档，删多余 title、补缺失正文、纠正非法选区。这是「文档永远合法」的关键。
- **`Mod-a` 重写**：原生 `Mod-a` 会从文档开头选到结尾（包含标题），重写后只选正文，更符合笔记直觉。

---

## 7. 标题外观 NoteTitleField（受控输入 + IME 兼容）

`NoteTitleField` 是一个**可独立复用**的标题输入组件，TipTap NodeView 和长文窗外标题都复用它。

```tsx
// src/components/design/RichEditor/title/NoteTitleField.tsx
import { NotebookPen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';
import { richEditorLocaleOf } from '../locale';

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Enter / Tab：交给正文 */
  onContinue?: () => void;
  className?: string;
};

/**
 * 笔记标题外观（徽章 + 输入 + 字数）。
 * TipTap Title NodeView 与长文窗外标题共用，避免两套 UI。
 *
 * IME 兼容要点：
 * - composing ref：输入法组合中不把 value 同步回 local，避免光标跳
 * - compositionEnd 才真正 commit
 */
export function NoteTitleField({
  value,
  onChange,
  onContinue,
  className,
}: Props) {
  const { locale, t } = useI18n();
  const editorLocale = richEditorLocaleOf(locale);
  // 输入法组合中标志
  const composing = useRef(false);
  // 本地受控值：保证 IME 组合期间 UI 流畅
  const [local, setLocal] = useState(value);

  // 外部 value 变化时同步到 local（但 IME 组合中不同步，避免打断）
  useEffect(() => {
    if (composing.current) return;
    setLocal(value);
  }, [value]);

  // 提交：更新 local，非 IME 组合时才回调 onChange
  const commit = (next: string) => {
    setLocal(next);
    if (!composing.current) onChange(next);
  };

  return (
    <div
      className={cn(
        'rich-editor-note-title flex flex-col gap-2 mb-2',
        className,
      )}
    >
      <div className="relative flex flex-col gap-2 p-3 pr-0 pt-9 border border-theme/5 bg-theme/5 rounded-md">
        {/* 左上角徽章：笔记标识 */}
        <div className="absolute -inset-0.5 bg-theme/20 border border-theme/5 text-theme/80 rounded-tl-md rounded-br-md pl-3 py-3.5 w-26 h-6 flex items-center gap-2">
          <NotebookPen className="size-4" />
          <span className="text-sm font-medium pb-0.5">
            {t('learningNotes.titleBadge')}
          </span>
        </div>
        <Input
          className="h-12 size-full px-0 py-0 text-xl md:text-xl rounded-none border-0 bg-transparent text-textcolor shadow-none placeholder:text-lg placeholder:text-textcolor/35 focus-visible:border-0 focus-visible:ring-0"
          value={local}
          placeholder={editorLocale.placeholderHeadingHint}
          maxLength={50}
          showCount
          // tabIndex={-1}：标题不参与 Tab 焦点链，Tab 直接跳到正文
          tabIndex={-1}
          // 阻止 mousedown 冒泡：避免 ProseMirror 抢焦点（NodeView 场景）
          onMouseDown={(e) => e.stopPropagation()}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            // 组合结束才真正提交
            commit(e.currentTarget.value);
          }}
          onChange={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            // IME 组合中的按键不处理
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              onContinue?.();
            }
          }}
        />
      </div>
    </div>
  );
}
```

### 7.1 实现要点

- **`composing` ref + `compositionEnd` 提交**：中文/日文输入法组合过程中（如打「ni'hao」选「你好」），如果每次 `onChange` 都回写 ProseMirror，光标会跳。所以组合期间只更新 `local`，`compositionEnd` 才 `commit`。
- **`onMouseDown` stopPropagation**：在 NodeView 内，ProseMirror 默认会拦截 mousedown 把焦点抢到正文，这里阻止冒泡让 Input 保持焦点。
- **`tabIndex={-1}`**：Tab 键不经过标题，直接跳到正文，符合「标题→正文」的输入流。
- **`maxLength={50}` + `showCount`**：标题长度限制与字数显示。

---

## 8. 空段落删除扩展 EmptyParagraphDelete

### 8.1 解决什么问题？

当文档结构是 `title + 空段落 + 图片` 时，光标在空段落上按 Backspace，原生 ProseMirror 会尝试「合并到前一个块」，但前一个是 atom（title），合并失败，**表现为按 Backspace 没反应**。同理 Delete 在空段落末尾也删不掉。

这个扩展补上这个行为：空段落上 Backspace/Delete 直接删除该段落。

```ts
// src/components/design/RichEditor/extensions/EmptyParagraphDelete.ts
import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';

/** 判断节点是否是「空段落」（含 <p><br></p>） */
function isEmptyParagraphNode(node: PmNode): boolean {
  if (node.type.name !== 'paragraph') return false;
  // 完全空
  if (node.content.size === 0) return true;
  // 仅含 <br>（hardBreak）也算空
  let onlyBreaks = true;
  node.forEach((child) => {
    if (child.type.name !== 'hardBreak') onlyBreaks = false;
  });
  return onlyBreaks;
}

/** 当前是否在空段落内（光标为空文本选区 + 父节点是空段落） */
function emptyParagraphAt(selection: Selection) {
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  if (!isEmptyParagraphNode(parent)) return null;
  return {
    $from,
    parent,
    from: $from.before(),          // 段落开始位置
    to: $from.before() + parent.nodeSize,  // 段落结束位置
  };
}

/** 删掉后文档是否仍满足最少块数（有 title 时至少 title+1 块，否则至少 1 块） */
function canRemoveBlock(doc: {
  childCount: number;
  firstChild?: { type: { name: string } } | null;
}): boolean {
  const min = doc.firstChild?.type.name === 'title' ? 2 : 1;
  return doc.childCount > min;
}

/**
 * 空段落卡在 title/文档开头与图片之间时，原生 Backspace 无法「并进」atom，表现为删不掉。
 * 在空段开头 Backspace / 空段末尾 Delete 时直接删掉该段。
 */
export const EmptyParagraphDelete = Extension.create({
  name: 'emptyParagraphDelete',

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const hit = emptyParagraphAt(editor.state.selection);
        // 不在空段落，或光标不在段落开头 → 交给原生处理
        if (!hit || hit.$from.parentOffset !== 0) return false;
        // 文档块数不足，不能删
        if (!canRemoveBlock(editor.state.doc)) return false;

        const { from, to } = hit;
        return editor
          .chain()
          .command(({ tr, dispatch }) => {
            tr.delete(from, to);
            // 删完把光标放到最近的合法位置（避免落在 atom 上）
            const pos = Math.min(from, tr.doc.content.size);
            tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
            dispatch?.(tr);
            return true;
          })
          .run();
      },
      Delete: ({ editor }) => {
        const hit = emptyParagraphAt(editor.state.selection);
        if (!hit) return false;
        // 光标不在段落末尾 → 交给原生
        if (hit.$from.parentOffset !== hit.parent.content.size) return false;
        if (!canRemoveBlock(editor.state.doc)) return false;
        // 已经是文档末尾 → 不删（避免删掉 trailing paragraph）
        if (hit.to >= editor.state.doc.content.size) return false;

        const { from, to } = hit;
        return editor
          .chain()
          .command(({ tr, dispatch }) => {
            tr.delete(from, to);
            const pos = Math.min(from, tr.doc.content.size);
            tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
            dispatch?.(tr);
            return true;
          })
          .run();
      },
    };
  },
});
```

### 8.1 实现要点

- **`return false` 的语义**：在 Tiptap 键盘快捷键里，`return false` 表示「我不处理这个按键」，事件会继续传给下一个处理器或原生行为。所以「不在空段落」「光标不在边界」都要 `return false`，不能 `return true`（会吞掉按键）。
- **`canRemoveBlock` 守卫**：保证删完后文档仍满足 `title block+` 的最小结构，不会把正文删空。
- **`Selection.near(pos, 1)`**：删除后把光标放到附近合法的文本位置，`1` 表示偏好向后找。

---

## 9. 图片处理 image.ts（选图 / 粘贴 / 拖放 / 格式归一）

这一章是**纯函数工具集**，不依赖 Tiptap，可单独测试。

```ts
// src/components/design/RichEditor/image/image.ts
import type { Editor } from '@tiptap/react';

// DOCX 导出安全的图片类型（避免 webp/avif 线上导出失败）
const DOCX_SAFE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif']);

/** 把浏览器能解码的图统一成 JPEG data URL（避免 webp/avif 线上导出失败） */
function bitmapToJpegDataUrl(
  source: ImageBitmap | HTMLImageElement,
  quality = 0.9,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, source.width);
  canvas.height = Math.max(1, source.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  ctx.drawImage(source, 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * 任意图片文件 → JPEG data URL
 * 优先用 createImageBitmap（性能好、支持 WebP/AVIF 解码）
 * 降级用 <img> + objectURL
 */
async function fileToJpegDataUrl(file: File): Promise<string> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    try {
      return bitmapToJpegDataUrl(bmp);
    } finally {
      bmp.close();
    }
  }
  // 降级：用 <img> 加载再画到 canvas
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image decode failed'));
      el.src = objectUrl;
    });
    return bitmapToJpegDataUrl(img);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * 本地文件 → data URL
 * 策略：
 * - jpeg/jpg/png/gif：直接 FileReader 读（保留原格式，DOCX 导出安全）
 * - 其他（webp/avif/heic 等）：先转 JPEG
 * - 转换失败（如 heic 浏览器解不了）：退回原始 data URL，交给服务端 sharp 处理
 */
export function fileToDataUrl(file: File): Promise<string> {
  const type = (file.type || '').toLowerCase();
  if (DOCX_SAFE.has(type)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }
  return fileToJpegDataUrl(file).catch(() => {
    // 浏览器解不了（如部分 heic）时退回原始 data URL，交给服务端 sharp
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  });
}

/** 系统文件选择器选本地图片（不用 window.prompt，Tauri 也能用） */
export function pickImageFile(accept = 'image/*'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = false;
    let settled = false;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      resolve(file);
    };
    input.onchange = () => done(input.files?.[0] ?? null);
    // Chromium / Tauri WebView 支持 cancel 事件
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** 判断是否图片文件 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** 从剪贴板事件提取图片文件 */
export function clipboardImageFiles(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) return [];
  const out: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item?.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

/** 从 DataTransfer 提取图片文件（拖放用） */
export function dataTransferImageFiles(dt: DataTransfer | null): File[] {
  if (!dt?.files?.length) return [];
  return [...dt.files].filter(isImageFile);
}

/** 图片上传函数类型：返回图片 src（data URL 或远程 URL） */
export type ResolveImageSrc = (
  file: File,
) => string | Promise<string | null | undefined>;

/**
 * 批量插入图片到编辑器
 * - 逐个解析 src（支持异步上传）
 * - 用 setImage 命令插入，alt 设为文件名
 */
export async function insertImages(
  editor: Editor,
  files: File[],
  resolveSrc: ResolveImageSrc,
): Promise<void> {
  for (const file of files) {
    if (!isImageFile(file)) continue;
    const src = await resolveSrc(file);
    if (!src?.trim()) continue;
    editor.chain().focus().setImage({ src: src.trim(), alt: file.name }).run();
  }
}
```

### 9.1 实现要点

- **格式归一为 JPEG**：WebP/AVIF 在某些 DOCX 导出库（如 docx.js）里会失败，统一转 JPEG 保证导出链路顺畅。JPEG/PNG/GIF 保留原格式（有透明通道的需求）。
- **`createImageBitmap` 优先**：比 `<img>` 解码快，且不污染 DOM。`bmp.close()` 释放内存。
- **降级链路**：`createImageBitmap` 失败 → `<img>` 解码 → 都失败 → 原始 data URL（交给服务端处理）。
- **`pickImageFile` 用动态 `<input>`**：不依赖 `window.prompt`（Tauri WebView 不支持），且能监听 `cancel` 事件。

---

## 10. 图片上传扩展 ImageUpload.ts

这一章把第 9 章的工具接到 Tiptap，拦截 `paste` / `drop` 事件自动插图。

```ts
// src/components/design/RichEditor/image/ImageUpload.ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  clipboardImageFiles,
  dataTransferImageFiles,
  fileToDataUrl,
  insertImages,
  type ResolveImageSrc,
} from './image';

export type ImageUploadOptions = {
  /** 可变引用：始终读最新上传实现（默认 FileReader → data URL） */
  resolveSrcRef: { current: ResolveImageSrc };
};

/**
 * 粘贴 / 拖放本地图片到编辑器。
 *
 * 为什么用 ref 而不是直接传函数？
 * Tiptap 的 useEditor 只在挂载时读一次 extensions，后续 props.onUploadImage 变化
 * 不会重建扩展。把可变上传逻辑放在 ref 里，每次 paste/drop 都读 ref.current，
 * 这样 props 变化时无需重建编辑器。
 */
export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: 'imageUpload',

  addOptions() {
    return {
      resolveSrcRef: { current: fileToDataUrl },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { resolveSrcRef } = this.options;

    return [
      new Plugin({
        key: new PluginKey('imageUpload'),
        props: {
          // 拦截粘贴
          handlePaste(_view, event) {
            const files = clipboardImageFiles(event);
            if (!files.length) return false;  // 没图片，交给原生处理文本
            event.preventDefault();
            // 注意：resolveSrcRef.current 始终读最新实现
            void insertImages(editor, files, (f) => resolveSrcRef.current(f));
            return true;
          },
          // 拦截拖放
          handleDrop(_view, event, _slice, moved) {
            // moved=true 表示是编辑器内部拖动（移动已有节点），不处理
            if (moved) return false;
            const files = dataTransferImageFiles(event.dataTransfer);
            if (!files.length) return false;
            event.preventDefault();
            void insertImages(editor, files, (f) => resolveSrcRef.current(f));
            return true;
          },
        },
      }),
    ];
  },
});
```

### 10.1 实现要点

- **`resolveSrcRef` 模式**：这是把「可变 props」接进「不可变扩展」的标准技巧。`useEditor` 挂载时扩展拿到 ref，后续每次 paste/drop 都读 `ref.current`，主组件在渲染时更新 `ref.current = onUploadImage ?? fileToDataUrl`（见第 16 章）。
- **`handlePaste` 返回 `false`**：没有图片时不拦截，让文本粘贴正常走。
- **`handleDrop` 的 `moved` 参数**：`moved=true` 是编辑器内部节点拖动（如拖动图片换位置），不该当成上传。

---

## 11. 链接处理 linkRange.ts + LinkForm.tsx

### 11.1 选区工具 linkRange.ts

设链接前要先确定「给谁加链接」。这个文件定义了选区解析逻辑，对齐常见富文本行为。

```ts
// src/components/design/RichEditor/link/linkRange.ts
import type { Editor } from '@tiptap/core';
import { getMarkRange, isTextSelection } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

export type LinkRange = { from: number; to: number };

/**
 * 解析「设链目标」选区（对齐常见富文本行为）：
 * 1. 已有文本选区 → 用选区
 * 2. 光标在已有链接内 → 扩展到整段 link mark
 * 3. 光标落在词/连续非空白内 → 扩展到该词（含中文连续字）
 * 4. 否则 → 扩展到当前行（文本块）的全部文本
 * 5. 空行 → null（绝不把 URL 插入正文）
 */
export function resolveLinkTarget(state: EditorState): LinkRange | null {
  const { selection, doc, schema } = state;
  const { from, to, empty, $from } = selection;

  // 1. 非空选区：直接用
  if (!empty && to > from) return { from, to };

  // 2. 光标在已有链接 mark 内：扩展到整段
  if (isTextSelection(selection) && schema.marks.link) {
    const markRange = getMarkRange($from, schema.marks.link);
    if (markRange && markRange.to > markRange.from) return markRange;
  }

  // 3. 扩展到当前词
  const word = expandNonWhitespaceAround(doc, from);
  if (word) return word;

  // 4. 扩展到当前行（文本块）
  if ($from.parent.isTextblock) {
    const start = $from.start();
    const end = $from.end();
    if (end > start) return { from: start, to: end };
  }

  // 5. 空行：返回 null，调用方据此显示「请先选中文字」提示
  return null;
}

/**
 * 从 pos 向两侧扩到连续非空白（一个「词」）
 * 支持 CJK：中文没有空格分词，连续汉字算一个词
 */
function expandNonWhitespaceAround(doc: PmNode, pos: number): LinkRange | null {
  const size = doc.content.size;
  if (size < 1) return null;

  const clamped = Math.max(0, Math.min(pos, size));
  const $pos = doc.resolve(clamped);
  if (!$pos.parent.isTextblock) return null;

  const blockStart = $pos.start();
  const blockEnd = $pos.end();
  if (blockEnd <= blockStart) return null;

  // 取整个文本块的文本
  const text = doc.textBetween(blockStart, blockEnd, '\n', '\0');
  if (!text.trim()) return null;

  // 光标在块内的偏移
  let offset = Math.max(0, Math.min(clamped - blockStart, text.length));

  // 光标在字符右侧时，优先贴到左侧字符（更符合直觉）
  if (
    offset > 0 &&
    (offset >= text.length || /\s/.test(text[offset]!)) &&
    !/\s/.test(text[offset - 1]!)
  ) {
    offset -= 1;
  }

  // 光标在空白上：无法形成词
  if (offset >= text.length || /\s/.test(text[offset]!)) return null;

  // 向左扩到非空白边界
  let left = offset;
  let right = offset + 1;
  while (left > 0 && !/\s/.test(text[left - 1]!)) left -= 1;
  // 向右扩到非空白边界
  while (right < text.length && !/\s/.test(text[right]!)) right += 1;

  return { from: blockStart + left, to: blockStart + right };
}

/** 给指定范围加链接 mark */
export function applyLinkToRange(
  editor: Editor,
  range: LinkRange,
  href: string,
) {
  // 只 setTextSelection + setLink，勿串联 extendMarkRange（无 mark 时会中断 chain）
  editor.chain().focus().setTextSelection(range).setLink({ href }).run();
}

/** 移除指定范围的链接 mark */
export function removeLinkInRange(editor: Editor, range: LinkRange) {
  editor.chain().focus().setTextSelection(range).unsetLink().run();
}
```

### 11.2 链接输入面板 + 状态机 LinkForm.tsx

不用 `window.prompt`（Tauri 不支持），自己写一个面板 + 状态机。

```tsx
// src/components/design/RichEditor/link/LinkForm.tsx
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import type { RichEditorLocale } from '../locale';
import {
  applyLinkToRange,
  type LinkRange,
  removeLinkInRange,
  resolveLinkTarget,
} from './linkRange';

export type LinkDraft = {
  href: string;
  /** 设链目标；null 表示空行，无法设链 */
  range: LinkRange | null;
};

type LinkFormProps = {
  locale: RichEditorLocale;
  href: string;
  onHrefChange: (href: string) => void;
  onApply: () => void;
  onRemove: () => void;
  onClose: () => void;
  /** 空行无法设链时的提示 */
  hint?: string;
};

/** 自定义链接输入面板（替代 window.prompt，适配 Tauri） */
export function LinkForm({
  locale: t,
  href,
  onHrefChange,
  onApply,
  onRemove,
  onClose,
  hint,
}: LinkFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开即聚焦 + 全选，方便覆盖默认 https://
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className="flex items-center gap-1 p-3 pb-2"
      role="dialog"
      aria-label={t.link}
      // 点击空白处不 blur（保持输入焦点），但点击 input/button 不阻止
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('input,button')) return;
        e.preventDefault();
      }}
    >
      <Input
        ref={inputRef}
        type="text"
        inputMode="url"
        autoComplete="url"
        className="text-textcolor/80 flex-1 shadow-none border-theme/15 focus-visible:border-theme/30 focus-visible:ring-0"
        placeholder={t.linkPlaceholder}
        value={href}
        onChange={(e) => onHrefChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onApply();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      {hint ? <span className="rich-editor-link-hint">{hint}</span> : null}
      <Button type="button" disabled={!!hint} onClick={onApply}>
        {t.linkApply}
      </Button>
      <Button type="button" onClick={onRemove}>
        {t.unlink}
      </Button>
      <Button type="button" onClick={onClose}>
        {t.linkCancel}
      </Button>
    </div>
  );
}

/** 规整 href：补协议、清空占位 */
function normalizeHref(raw: string): string {
  const url = raw.trim();
  if (!url || url === 'https://' || url === 'http://') return '';
  // 没有协议头（如 example.com）补 https://
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return `https://${url}`;
  return url;
}

/**
 * 打开 / 应用链接的状态机。
 * 打开时即锁定目标选区（选区 / 词 / 整行），应用时只给目标加 mark，不把 URL 插入正文。
 *
 * 为什么「打开即锁定选区」？
 * 用户打开链接面板后可能在输入框停留很久，期间选区可能变化（如点击别处）。
 * 锁定打开瞬间的选区，保证「看到要加链接的范围」与「实际加链接的范围」一致。
 */
export function useLinkEditor(editor: Editor | null) {
  const [draft, setDraft] = useState<LinkDraft | null>(null);

  const open = useCallback(() => {
    if (!editor) return;
    // 解析设链目标
    const range = resolveLinkTarget(editor.state);
    // 取已有链接 href 作为默认值（编辑场景）
    const prev =
      (editor.getAttributes('link').href as string | undefined) ?? '';

    // 有目标时先选中，让用户看见将要加链接的范围
    if (range) {
      editor.chain().setTextSelection(range).run();
    }

    setDraft({
      href: prev || 'https://',
      range,
    });
  }, [editor]);

  const close = useCallback(() => setDraft(null), []);

  const apply = useCallback(() => {
    if (!editor || !draft) return;
    const href = normalizeHref(draft.href);

    // 空行（无目标）：不插入 URL 正文，直接关闭
    if (!draft.range) {
      setDraft(null);
      return;
    }

    // href 为空：移除链接
    if (!href) {
      removeLinkInRange(editor, draft.range);
      setDraft(null);
      return;
    }

    // 正常应用
    applyLinkToRange(editor, draft.range, href);
    setDraft(null);
  }, [draft, editor]);

  const remove = useCallback(() => {
    if (!editor || !draft) return;
    if (draft.range) removeLinkInRange(editor, draft.range);
    setDraft(null);
  }, [draft, editor]);

  const setHref = useCallback((href: string) => {
    setDraft((d) => (d ? { ...d, href } : d));
  }, []);

  return { draft, open, close, apply, remove, setHref };
}
```

### 11.3 实现要点

- **`resolveLinkTarget` 五级回退**：选区 → 已有链接 → 词 → 行 → null。这覆盖了「选中文字加链接」「光标在链接上改链接」「光标在词上加链接」「光标在空行上」全部场景。
- **`expandNonWhitespaceAround` 支持 CJK**：中文没有空格，连续汉字算一个词，符合直觉。
- **`useLinkEditor` 打开即锁定选区**：避免用户在输入框停留期间选区漂移导致「加错位置」。
- **`normalizeHref` 补协议**：用户输 `example.com` 自动补成 `https://example.com`，但 `mailto:`/`tel:` 等自定义协议保留。

---

## 12. 代码语言配置 code/languages.ts

简单清单，但单独抽文件便于扩展。

```ts
// src/components/design/RichEditor/code/languages.ts

/** 代码块语法高亮：主流语言（中文标签） */
export const CODE_LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'less', label: 'Less' },
  { value: 'scss', label: 'SCSS' },
  { value: 'rust', label: 'Rust' },
  { value: 'python', label: 'Python' },
  { value: 'c', label: 'C' },
  { value: 'java', label: 'Java' },
  { value: 'json', label: 'JSON' },
  { value: 'go', label: 'Go' },
  { value: 'sql', label: 'SQL' },
  { value: 'wasm', label: 'Wasm' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'shell', label: 'Shell' },
  { value: 'bash', label: 'Bash' },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]['value'];
```

```ts
// src/components/design/RichEditor/code/index.ts
export { CODE_LANGUAGES, type CodeLanguage } from './languages';
```

> **注意**：`lowlight` 的 `common` 预置包已包含上述语言的语法定义，无需额外注册。如果要用 `all`（全语言），体积会大很多，按需取舍。

---

## 13. 扩展组装 extensions/index.ts（含 TabIndent / CustomDocument）

这是把所有扩展组装到一起的地方。除了直接用第三方扩展，还有两个自定义扩展：`TabIndent`（Tab 缩进）和 `CustomDocument`（约束文档结构）。

```ts
// src/components/design/RichEditor/extensions/index.ts
import { Extension } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Document from '@tiptap/extension-document';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { CharacterCount } from '@tiptap/extensions';
import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { fileToDataUrl, ImageUpload } from '../image';
import { zhCN } from '../locale';
import { indentEditor, TitleNode } from '../title';
import type { CreateExtensionsOptions } from '../types';
import { EmptyParagraphDelete } from './EmptyParagraphDelete';

// 用 lowlight 的 common 预置包创建语法高亮实例
const lowlight = createLowlight(common);

/**
 * Tab：列表下沉 / 正文插入缩进；并吞掉默认焦点切换（避免跳到标题 input）
 * priority: 1000 → 优先级高于其他扩展，保证 Tab 先被这里处理
 */
const TabIndent = Extension.create({
  name: 'tabIndent',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        // 代码块里 Tab 由 CodeBlockLowlight 的 enableTabIndentation 处理
        if (editor.isActive('codeBlock')) return false;
        return indentEditor(editor);
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('codeBlock')) return false;
        // 列表里 Shift-Tab 提升一级
        if (editor.commands.liftListItem('listItem')) return true;
        if (editor.commands.liftListItem('taskItem')) return true;
        return true;
      },
    };
  },
});

/**
 * 首位固定 title，其后至少一段正文（避免仅有 atom 时 GapCursor 无法输入）
 * 继承 Document 并覆盖 content 表达式
 */
const CustomDocument = Document.extend({
  content: 'title block+',
});

/**
 * 组装默认扩展；业务可通过 extensions / extraExtensions 覆盖或追加
 * @param options - 控制各扩展的开关与配置
 */
export function createExtensions(
  options: CreateExtensionsOptions = {},
): Extensions {
  // 业务完全替换：直接返回
  if (options.extensions) return options.extensions;

  const placeholder = options.placeholder ?? zhCN.placeholder;
  const resolveImageSrcRef = options.resolveImageSrcRef ?? {
    current: fileToDataUrl,
  };
  // 默认开启 CharacterCount；显式 false 时跳过（无字数 UI 且无上限时关掉，避免每键 Segmenter 开销）
  const withCharCount = options.characterCount !== false;
  // 默认显示标题
  const withTitle = options.showTitle !== false;

  const baseExtensions: Extensions = [
    // === 文档结构 ===
    // 有标题时用 CustomDocument（约束 title block+），否则用默认 Document
    ...(withTitle ? [CustomDocument, TitleNode] : []),

    // === 自定义扩展 ===
    TabIndent,
    EmptyParagraphDelete,

    // === StarterKit（含 Bold/Italic/Strike/Code/Underline/Link/History/ListKeymap/TrailingNode 等）===
    StarterKit.configure({
      // 有标题时禁用默认 Document（用 CustomDocument）
      document: withTitle ? false : undefined,
      trailingNode: {
        node: 'paragraph',  // 末尾始终留一个空段，方便继续输入
      },
      heading: { levels: [1, 2, 3, 4, 5] },
      // 禁用内置 CodeBlock，用 CodeBlockLowlight 替代（带语法高亮）
      codeBlock: false,
      // TipTap 3：undoRedo（非 history）；长文降低深度，减轻内存与事务
      undoRedo: { depth: 50 },
      link: {
        openOnClick: false,   // 编辑模式下不跳转
        autolink: true,       // 自动识别 URL 转 link
        defaultProtocol: 'https',
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      },
    }),

    // === 代码块（语法高亮）===
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'javascript',
      enableTabIndentation: true,  // 代码块内 Tab 缩进
      tabSize: 2,
      HTMLAttributes: { class: 'hljs' },  // 配合 styles.css 的 hljs-* 配色
    }),

    // === 占位符 ===
    Placeholder.configure({
      // 根据节点类型返回不同占位符
      placeholder: ({ editor, node }) => {
        // 标题节点不显示占位符（标题有自己的 placeholder）
        if (withTitle && node.type.name === 'title') return '';
        if (node.type.name === 'heading') {
          return `${zhCN.placeholderHeading} ${node.attrs.level}`;
        }
        void editor;
        return placeholder;
      },
      emptyEditorClass: 'is-editor-empty',  // 整个编辑器空时加的 class
      emptyNodeClass: 'is-empty',           // 单个块空时加的 class
      showOnlyCurrent: true,                // 只在当前光标所在块显示
      showOnlyWhenEditable: true,           // 只在可编辑时显示
    }),

    // === 高亮（多色）===
    Highlight.configure({ multicolor: true }),

    // === 文本对齐 ===
    TextAlign.configure({
      types: ['heading', 'paragraph'],  // 只对标题和段落生效
      alignments: ['left', 'center', 'right', 'justify'],
    }),

    // === 图片 ===
    Image.configure({
      inline: false,        // 块级图片（独占一行）
      allowBase64: true,    // 允许 base64（本地图片）
      HTMLAttributes: { class: 'rich-editor-image' },
      // 图片拖拽缩放（默认关闭：长文下 NodeView/监听开销大）
      ...(options.imageResize
        ? {
            resize: {
              enabled: true,
              alwaysPreserveAspectRatio: true,
            },
          }
        : {}),
    }),
    // 粘贴/拖放图片拦截
    ImageUpload.configure({ resolveSrcRef: resolveImageSrcRef }),

    // === 表格 ===
    TableKit.configure({
      table: { resizable: options.tableResizable === true },
    }),

    // === 任务列表 ===
    TaskList,
    TaskItem.configure({ nested: true }),  // 允许嵌套

    // === 字数统计 ===
    ...(withCharCount
      ? [
          CharacterCount.configure({
            limit: options.maxLength ?? null,  // 上限，null 表示只统计不限制
            // 字符计数：用 Intl.Segmenter 按 grapheme（字形）计数
            // 比按 UTF-16 码元更准确（如 emoji 算 1 个字）
            textCounter: (text) =>
              [
                ...new Intl.Segmenter('zh', {
                  granularity: 'grapheme',
                }).segment(text),
              ].length,
            // 词计数：CJK 按字数，Latin 按空格分词
            wordCounter: (text) => {
              const cjk =
                text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g)
                  ?.length ?? 0;
              const latin = text
                .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ')
                .split(/\s+/)
                .filter(Boolean).length;
              return cjk + latin;
            },
          }),
        ]
      : []),

    // === 业务追加扩展 ===
    ...(options.extraExtensions ?? []),
  ];

  return baseExtensions;
}
```

### 13.1 实现要点

- **`StarterKit.configure({ document: false })`**：有标题时禁用默认 Document，让 `CustomDocument` 接管。否则两个 Document 扩展会冲突。
- **`codeBlock: false` + `CodeBlockLowlight`**：内置 CodeBlock 没有语法高亮，用 lowlight 版替换。
- **`undoRedo: { depth: 50 }`**：长文下历史深度过高会占内存，50 步够用。
- **`CharacterCount` 的 `textCounter` 用 `Intl.Segmenter`**：`'emoji👨‍👩‍👧'.length` 是 11，但 `Segmenter` 按 grapheme 计数是 2，更符合用户直觉。
- **`wordCounter` 的 CJK + Latin 混合**：中文按字数，英文按空格分词，相加得「词数」。
- **`Placeholder` 标题节点返回空串**：标题有自己的 placeholder（NoteTitleField），不重复显示。

---

## 14. 工具栏 Toolbar.tsx（响应式溢出 + 状态订阅）

工具栏是这个编辑器里代码量最大的部分。核心难点是**响应式溢出**：按钮太多放不下时，自动把溢出的收进「更多」下拉菜单。

```tsx
// src/components/design/RichEditor/toolbar/Toolbar.tsx
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight,
  Bold, CheckSquare, Code, Heading, Heading1, Heading2, Heading3,
  Heading4, Heading5, Highlighter, ImageIcon, Italic, Link2, Link2Off,
  List, ListOrdered, Minus, MoreHorizontal, Quote, Redo2,
  RemoveFormatting, Strikethrough, Table, Underline, Undo2,
} from 'lucide-react';
import { Fragment, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CODE_LANGUAGES } from '../code';
import { fileToDataUrl, insertImages, pickImageFile, type ResolveImageSrc } from '../image';
import type { RichEditorLocale } from '../locale';

type Props = {
  editor: Editor;
  locale: RichEditorLocale;
  onUploadImage?: ResolveImageSrc;
  onOpenLink: () => void;
  linkOpen?: boolean;
  extra?: ReactNode;
  className?: string;
};

// 工具项：node 是工具栏内联节点，menu 是「更多」下拉里的节点
type ToolItem = {
  id: string;
  node: ReactNode;
  /** 「更多」菜单内节点；缺省则仅内联展示 */
  menu?: ReactNode;
};

const ICON = 15;
/** More 按钮自身宽度（1.75rem + ml-0.5），不含 flex gap */
const MORE_W = 30;

/**
 * 通用按钮：阻止 mousedown 默认行为（避免点击按钮时编辑器失焦）
 * active 时加 is-active class 高亮
 */
export function Btn({
  title, active, disabled, onClick, children, className,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (e?: MouseEvent) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={cn('rich-editor-btn ml-0.5', active && 'is-active', className)}
      // 阻止 mousedown 默认：避免按钮点击导致编辑器失焦
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onClick(e as unknown as MouseEvent)}
    >
      {children}
    </button>
  );
}

/** 「更多」下拉菜单里的行 */
function MenuRow({
  title, active, disabled, onSelect, children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      title={title}
      className={cn(active && 'bg-theme/10')}
      onSelect={onSelect}
    >
      <div className="flex w-full items-center gap-2">
        {children}
        <span className="text-sm text-textcolor/90">{title}</span>
      </div>
    </DropdownMenuItem>
  );
}

export function Toolbar({
  editor, locale: t, onUploadImage, onOpenLink, linkOpen, extra, className,
}: Props) {
  // === 1. 订阅编辑器状态：用 useEditorState 只在 selector 返回值变化时重渲染 ===
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      h4: e.isActive('heading', { level: 4 }),
      h5: e.isActive('heading', { level: 5 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      // 当前代码块语言
      codeLanguage:
        (e.getAttributes('codeBlock').language as string | undefined) ??
        'javascript',
      link: e.isActive('link'),
      alignLeft: e.isActive({ textAlign: 'left' }),
      alignCenter: e.isActive({ textAlign: 'center' }),
      alignRight: e.isActive({ textAlign: 'right' }),
      alignJustify: e.isActive({ textAlign: 'justify' }),
      inTable: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  // === 2. 图片插入：选图 → 解析 → insertImages ===
  const insertImage = async () => {
    const file = await pickImageFile();
    if (!file) return;
    const resolve = onUploadImage ?? fileToDataUrl;
    await insertImages(editor, [file], resolve);
  };

  // === 3. 标题级别配置 ===
  const HEADING_LEVELS = [
    { level: 1 as const, icon: Heading1, title: t.h1 },
    { level: 2 as const, icon: Heading2, title: t.h2 },
    { level: 3 as const, icon: Heading3, title: t.h3 },
    { level: 4 as const, icon: Heading4, title: t.h4 },
    { level: 5 as const, icon: Heading5, title: t.h5 },
  ];

  // 当前激活的标题级别（用于触发器图标）
  const activeHeading =
    HEADING_LEVELS.find(({ level }) => state[`h${level}` as const]) ?? null;
  const HeadingTriggerIcon = activeHeading?.icon ?? Heading;

  const handleHeading = (level: 1 | 2 | 3 | 4 | 5) => {
    editor.chain().focus().toggleHeading({ level }).run();
  };

  // === 4. 构建工具项列表 ===
  const tools = useMemo((): ToolItem[] => {
    const items: ToolItem[] = [
      // 撤销 / 重做
      { id: 'undo', node: (<Btn title={t.undo} disabled={!state.canUndo} className="ml-0" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={ICON} /></Btn>),
        menu: (<MenuRow title={t.undo} disabled={!state.canUndo} onSelect={() => editor.chain().focus().undo().run()}><Undo2 size={ICON} /></MenuRow>) },
      { id: 'redo', node: (<Btn title={t.redo} disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={ICON} /></Btn>),
        menu: (<MenuRow title={t.redo} disabled={!state.canRedo} onSelect={() => editor.chain().focus().redo().run()}><Redo2 size={ICON} /></MenuRow>) },

      // 行内格式
      { id: 'bold', node: (<Btn title={t.bold} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={ICON} /></Btn>),
        menu: (<MenuRow title={t.bold} active={state.bold} onSelect={() => editor.chain().focus().toggleBold().run()}><Bold size={ICON} /></MenuRow>) },
      { id: 'italic', node: (<Btn title={t.italic} active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={ICON} /></Btn>),
        menu: (<MenuRow title={t.italic} active={state.italic} onSelect={() => editor.chain().focus().toggleItalic().run()}><Italic size={ICON} /></MenuRow>) },
      { id: 'underline', node: (<Btn title={t.underline} active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={ICON} /></Btn>),
        menu: (<MenuRow title={t.underline} active={state.underline} onSelect={() => editor.chain().focus().toggleUnderline().run()}><Underline size={ICON} /></MenuRow>) },
      { id: 'strike', node: (<Btn title={t.strike} active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={ICON} /></Btn>),
        menu: (<MenuRow title={t.strike} active={state.strike} onSelect={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={ICON} /></MenuRow>) },
      { id: 'highlight', node: (<Btn title={t.highlight} active={state.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={ICON} /></Btn>),
        menu: (<MenuRow title={t.highlight} active={state.highlight} onSelect={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={ICON} /></MenuRow>) },

      // 清除格式
      { id: 'clearFormat', node: (<Btn title={t.clearFormat} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={ICON} /></Btn>),
        menu: (<MenuRow title={t.clearFormat} onSelect={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={ICON} /></MenuRow>) },

      // 标题级别（下拉菜单）
      { id: 'heading', node: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title={activeHeading?.title ?? '标题级别'} aria-label={activeHeading?.title ?? '标题级别'}
              className={cn('rich-editor-btn ml-0.5', activeHeading && 'is-active')}
              onMouseDown={(e) => e.preventDefault()}>
              <HeadingTriggerIcon size={ICON} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" sideOffset={8} className="w-20" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-textcolor/90">标题级别</DropdownMenuLabel>
              {HEADING_LEVELS.map(({ level, icon: Icon, title }) => {
                const active = state[`h${level}` as const];
                return (
                  <DropdownMenuItem key={level} title={title} className={cn(active && 'bg-theme/10')} onSelect={() => handleHeading(level)}>
                    <div className="flex w-full items-center justify-between">
                      <Icon size={ICON} className="text-textcolor" />
                      <span className="text-sm text-textcolor/90">{title}</span>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      menu: (
        <>
          <DropdownMenuLabel className="text-textcolor/90">标题级别</DropdownMenuLabel>
          {HEADING_LEVELS.map(({ level, icon: Icon, title }) => {
            const active = state[`h${level}` as const];
            return (<MenuRow key={level} title={title} active={active} onSelect={() => handleHeading(level)}><Icon size={ICON} /></MenuRow>);
          })}
        </>
      ) },

      // 列表
      { id: 'bullet', node: (<Btn title={t.bulletList} active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={ICON} /></Btn>),
        menu: (<MenuRow title={t.bulletList} active={state.bullet} onSelect={() => editor.chain().focus().toggleBulletList().run()}><List size={ICON} /></MenuRow>) },
      { id: 'ordered', node: (<Btn title={t.orderedList} active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={ICON} /></Btn>),
        menu: (<MenuRow title={t.orderedList} active={state.ordered} onSelect={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={ICON} /></MenuRow>) },
      { id: 'task', node: (<Btn title={t.taskList} active={state.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare size={ICON} /></Btn>),
        menu: (<MenuRow title={t.taskList} active={state.task} onSelect={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare size={ICON} /></MenuRow>) },

      // 引用
      { id: 'quote', node: (<Btn title={t.blockquote} active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={ICON} /></Btn>),
        menu: (<MenuRow title={t.blockquote} active={state.quote} onSelect={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={ICON} /></MenuRow>) },

      // 代码块
      { id: 'codeBlock', node: (
        <Btn title={t.codeBlock} active={state.codeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock({ language: state.codeLanguage || 'javascript' }).run()}>
          <Code size={ICON} />
        </Btn>
      ),
      menu: (
        <MenuRow title={t.codeBlock} active={state.codeBlock}
          onSelect={() => editor.chain().focus().toggleCodeBlock({ language: state.codeLanguage || 'javascript' }).run()}>
          <Code size={ICON} />
        </MenuRow>
      ) },
    ];

    // 仅当光标在代码块时显示语言选择器
    if (state.codeBlock) {
      items.push({
        id: 'codeLanguage',
        node: (
          <select
            className="rich-editor-lang"
            title={t.codeLanguage}
            aria-label={t.codeLanguage}
            value={state.codeLanguage}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value }).run();
            }}>
            {CODE_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
        ),
        menu: (
          <>
            <DropdownMenuLabel className="text-textcolor/90">{t.codeLanguage}</DropdownMenuLabel>
            {CODE_LANGUAGES.map((lang) => (
              <MenuRow key={lang.value} title={lang.label} active={state.codeLanguage === lang.value}
                onSelect={() => editor.chain().focus().updateAttributes('codeBlock', { language: lang.value }).run()}>
                <Code size={ICON} />
              </MenuRow>
            ))}
          </>
        ),
      });
    }

    // 分隔线 / 对齐 / 链接 / 图片 / 表格
    items.push(
      { id: 'hr', node: (<Btn title={t.horizontalRule} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={ICON} /></Btn>),
        menu: (<MenuRow title={t.horizontalRule} onSelect={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={ICON} /></MenuRow>) },

      { id: 'alignLeft', node: (<Btn title={t.alignLeft} active={state.alignLeft} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={ICON} /></Btn>),
        menu: (<MenuRow title={t.alignLeft} active={state.alignLeft} onSelect={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={ICON} /></MenuRow>) },
      { id: 'alignCenter', node: (<Btn title={t.alignCenter} active={state.alignCenter} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={ICON} /></Btn>),
        menu: (<MenuRow title={t.alignCenter} active={state.alignCenter} onSelect={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={ICON} /></MenuRow>) },
      { id: 'alignRight', node: (<Btn title={t.alignRight} active={state.alignRight} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={ICON} /></Btn>),
        menu: (<MenuRow title={t.alignRight} active={state.alignRight} onSelect={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={ICON} /></MenuRow>) },
      { id: 'alignJustify', node: (<Btn title={t.alignJustify} active={state.alignJustify} onClick={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify size={ICON} /></Btn>),
        menu: (<MenuRow title={t.alignJustify} active={state.alignJustify} onSelect={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify size={ICON} /></MenuRow>) },

      { id: 'link', node: (<Btn title={t.link} active={state.link || !!linkOpen} onClick={onOpenLink}><Link2 size={ICON} /></Btn>),
        menu: (<MenuRow title={t.link} active={state.link || !!linkOpen} onSelect={onOpenLink}><Link2 size={ICON} /></MenuRow>) },
      { id: 'unlink', node: (<Btn title={t.unlink} disabled={!state.link} onClick={() => editor.chain().focus().unsetLink().run()}><Link2Off size={ICON} /></Btn>),
        menu: (<MenuRow title={t.unlink} disabled={!state.link} onSelect={() => editor.chain().focus().unsetLink().run()}><Link2Off size={ICON} /></MenuRow>) },

      { id: 'image', node: (<Btn title={t.imagePick} onClick={() => void insertImage()}><ImageIcon size={ICON} /></Btn>),
        menu: (<MenuRow title={t.imagePick} onSelect={() => void insertImage()}><ImageIcon size={ICON} /></MenuRow>) },

      { id: 'table', node: (<Btn title={t.table} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table size={ICON} /></Btn>),
        menu: (<MenuRow title={t.table} onSelect={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table size={ICON} /></MenuRow>) },
    );

    // 仅当光标在表格内时显示表格操作
    if (state.inTable) {
      items.push(
        { id: 'addCol', node: (<Btn title={t.addColumnAfter} onClick={() => editor.chain().focus().addColumnAfter().run()}><span className="text-[10px] font-semibold">+列</span></Btn>),
          menu: (<MenuRow title={t.addColumnAfter} onSelect={() => editor.chain().focus().addColumnAfter().run()}><span className="text-[10px] font-semibold">+列</span></MenuRow>) },
        { id: 'addRow', node: (<Btn title={t.addRowAfter} onClick={() => editor.chain().focus().addRowAfter().run()}><span className="text-[10px] font-semibold">+行</span></Btn>),
          menu: (<MenuRow title={t.addRowAfter} onSelect={() => editor.chain().focus().addRowAfter().run()}><span className="text-[10px] font-semibold">+行</span></MenuRow>) },
        { id: 'delTable', node: (<Btn title={t.deleteTable} onClick={() => editor.chain().focus().deleteTable().run()}><span className="text-[10px] font-semibold">删表</span></Btn>),
          menu: (<MenuRow title={t.deleteTable} onSelect={() => editor.chain().focus().deleteTable().run()}><span className="text-[10px] font-semibold">删表</span></MenuRow>) },
      );
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 state / locale 字段对齐即可
  }, [editor, t, state, linkOpen, onOpenLink, onUploadImage]);

  // === 5. 响应式溢出计算 ===
  const rootRef = useRef<HTMLDivElement>(null);
  const extraRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tools.length);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return;

    const recalc = () => {
      const cs = getComputedStyle(root);
      const padX =
        (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const gap = parseFloat(cs.columnGap || cs.gap) || 0;
      const contentW = root.clientWidth - padX;
      const extraW = extraRef.current?.offsetWidth ?? 0;

      /** [start=tools+more][+extra] 是否放得进 contentW */
      const fits = (toolsW: number, withMore: boolean) => {
        const startW = toolsW + (withMore ? MORE_W : 0);
        let used = startW;
        if (extraW > 0) used += extraW + gap;
        // 偏保守，避免亚像素导致多塞一项被裁切
        return used <= contentW - 0.5;
      };

      // measure 容器里每个子项的实际宽度
      const nodes = [...measure.children] as HTMLElement[];
      if (nodes.length === 0) {
        setVisibleCount(0);
        return;
      }

      const widths = nodes.map((el) => el.getBoundingClientRect().width);
      const total = widths.reduce((a, b) => a + b, 0);

      // 全放下：不显示 More
      if (fits(total, false)) {
        setVisibleCount(widths.length);
        return;
      }

      // 逐项累加，找到能放下的最大数量（保留 More 的宽度）
      let used = 0;
      let count = 0;
      for (const w of widths) {
        if (!fits(used + w, true)) break;
        used += w;
        count += 1;
      }
      setVisibleCount(count);
    };

    recalc();
    // 监听容器尺寸变化（窗口缩放、父级布局变化）
    const ro = new ResizeObserver(recalc);
    ro.observe(root);
    if (extraRef.current) ro.observe(extraRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tools.length 足够代表槽位变化
  }, [tools.length, t, linkOpen]);

  const visible = tools.slice(0, visibleCount);
  const overflow = tools.slice(visibleCount);
  const showMore = overflow.length > 0;

  return (
    <div
      ref={rootRef}
      className={cn(
        'rich-editor-toolbar px-1.5 flex h-10 items-center justify-between border-b border-theme/10',
        className,
      )}
      role="toolbar"
      aria-label="格式工具栏"
    >
      {/* 隐形测量行：与真实按钮同构，用于算每项宽度 */}
      <div ref={measureRef} className="rich-editor-toolbar-measure" aria-hidden>
        {tools.map((item) => (
          <span key={item.id} className="inline-flex shrink-0">
            {item.node}
          </span>
        ))}
      </div>

      <div className="rich-editor-toolbar-start">
        <div className="rich-editor-toolbar-main">
          {visible.map((item) => (
            <span key={item.id} className="inline-flex shrink-0">
              {item.node}
            </span>
          ))}
        </div>

        {showMore ? (
          <span className="rich-editor-toolbar-more inline-flex shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title="更多" aria-label="更多"
                  className="rich-editor-btn ml-0.5"
                  onMouseDown={(e) => e.preventDefault()}>
                  <MoreHorizontal size={ICON} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="min-w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuGroup>
                  {overflow.map((item) => (
                    <Fragment key={item.id}>{item.menu}</Fragment>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        ) : null}
      </div>

      {extra != null && (
        <div ref={extraRef} className="rich-editor-toolbar-extra shrink-0">
          <div className="rich-editor-toolbar-group">{extra}</div>
        </div>
      )}
    </div>
  );
}
```

### 14.1 实现要点

- **`useEditorState` 而非 `useEditor` + `onUpdate`**：`useEditorState` 只在 selector 返回值变化时重渲染，比每次 `onUpdate` 都 setState 高效得多。
- **`onMouseDown={(e) => e.preventDefault()}`**：这是富文本工具栏的**关键技巧**。按钮点击默认会让编辑器失焦，导致 `editor.chain().focus()` 后选区丢失。阻止 mousedown 默认能保持选区。
- **响应式溢出的「测量行」**：渲染一份**与真实按钮同构但隐形**的副本（`position: absolute; left: -9999px; visibility: hidden`），用 `getBoundingClientRect` 量每项真实宽度，再算能放下几项。这比「估算」准确，能处理任意按钮（含下拉、select）。
- **`ResizeObserver` 监听容器**：窗口缩放、侧边栏折叠时自动重算可见数量。
- **条件工具项**：代码块语言选择器只在 `state.codeBlock` 时出现；表格操作只在 `state.inTable` 时出现。这避免了工具栏一直拥挤。
- **`tools` 的 `useMemo` 依赖 `state`**：每次编辑器状态变化都会重建 tools 数组，但 `useLayoutEffect` 依赖 `tools.length`（只在槽位数变化时重算宽度），避免每键都 `getBoundingClientRect`。

---

## 15. 选区气泡菜单 FormatBubble.tsx

气泡菜单是选中文本时浮在选区上方的小工具栏，提供最常用的行内格式。

```tsx
// src/components/design/RichEditor/toolbar/FormatBubble.tsx
import type { Editor } from '@tiptap/react';
import { Bold, Highlighter, Italic, Link2, Underline } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RichEditorLocale } from '../locale';

type Props = {
  editor: Editor;
  locale: RichEditorLocale;
  onOpenLink: () => void;
};

function Btn({
  title, onClick, children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rich-editor-btn"
      title={title}
      aria-label={title}
      // 同 Toolbar：阻止 mousedown 默认，避免失焦
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 选区气泡菜单：常用行内格式（粗体/斜体/下划线/高亮/链接） */
export function FormatBubble({ editor, locale: t, onOpenLink }: Props) {
  return (
    <div className="rich-editor-bubble" role="toolbar" aria-label="快捷格式">
      <Btn title={t.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={14} />
      </Btn>
      <Btn title={t.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={14} />
      </Btn>
      <Btn title={t.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline size={14} />
      </Btn>
      <Btn title={t.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter size={14} />
      </Btn>
      <Btn title={t.link} onClick={onOpenLink}>
        <Link2 size={14} />
      </Btn>
    </div>
  );
}
```

### 15.1 实现要点

- 气泡菜单只放**最常用**的 5 个行内格式，不放块级操作（标题、列表等）。块级操作放顶部工具栏。
- **不显示激活态**：气泡是临时浮层，激活态由顶部工具栏体现，避免视觉冗余。
- **`onOpenLink` 委托给主组件**：气泡只负责触发，链接面板的状态机在主组件的 `useLinkEditor` 里（见第 16 章）。

---

## 16. 主组件 RichEditor/index.tsx（编排一切）

这是把所有模块组装成最终组件的地方。

```tsx
// src/components/design/RichEditor/index.tsx
import { isTextSelection } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import {
  EditorContent,
  EditorContext,
  useEditor,
  useEditorState,
} from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { createExtensions } from './extensions';
import { fileToDataUrl, type ResolveImageSrc } from './image';
import { LinkForm, useLinkEditor } from './link';
import { type RichEditorLocale, zhCN } from './locale';
import './styles.css';
import { getDocTitleText, normalizeNoteContent } from './title';
import { FormatBubble, Toolbar } from './toolbar';
import type { RichEditorProps } from './types';

/** 合并文案：业务传 Partial，其余走中文默认 */
function mergeLocale(
  partial?: Partial<RichEditorLocale>,
  base: RichEditorLocale = zhCN,
): RichEditorLocale {
  return { ...base, ...partial };
}

/**
 * 字数统计组件
 * 用 useEditorState 订阅 characterCount storage，只在数字变化时重渲染
 */
function CharCount({
  editor,
  locale,
  maxLength,
}: {
  editor: Editor;
  locale: RichEditorLocale;
  maxLength?: number;
}) {
  const count = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      // CharacterCount 扩展把统计结果挂在 storage 上
      const storage = e.storage.characterCount as
        | { characters: () => number; words: () => number }
        | undefined;
      return {
        chars: storage?.characters() ?? 0,
        words: storage?.words() ?? 0,
      };
    },
  });

  // 超限标红
  const over = maxLength != null && count.chars >= maxLength;

  return (
    <div className={cn('rich-editor-footer', over && 'is-limit')}>
      <span>
        {count.words} {locale.words}
      </span>
      <span>
        {count.chars}
        {maxLength != null ? ` / ${maxLength}` : ''} {locale.chars}
        {over ? ` · ${locale.limitReached}` : ''}
      </span>
    </div>
  );
}

/**
 * TipTap 二次封装富文本编辑器。
 * - 默认中文 UI
 * - 内置 Formatting / 表格 / 本地图片(选图·粘贴·拖放) / 任务 / 字数 / RTL
 * - 通过 extraExtensions / toolbarExtra / onUploadImage 扩展
 */
export function RichEditor({
  content,
  defaultContent = '',
  onChange,
  editable = true,
  autofocus = true,
  placeholder,
  className,
  editorClassName,
  maxLength,
  textDirection = 'auto',
  showToolbar = true,
  showBubbleMenu = true,
  showCharCount = true,
  showTitle = true,
  imageResize = false,
  tableResizable = false,
  locale: localePartial,
  extensions,
  extraExtensions,
  toolbarExtra,
  onUploadImage,
  onCreate,
  onBodyScroll,
  renderBody,
}: RichEditorProps) {
  // === 1. 文案合并 ===
  const locale = useMemo(() => mergeLocale(localePartial), [localePartial]);

  // === 2. 可变 props 用 ref 接进扩展（避免重建编辑器）===
  // 图片上传：每次渲染更新 ref.current，扩展里读 ref.current 始终是最新实现
  const resolveImageSrcRef = useRef<ResolveImageSrc>(fileToDataUrl);
  resolveImageSrcRef.current = async (file) => {
    if (onUploadImage) return onUploadImage(file);
    return fileToDataUrl(file);
  };

  // onChange / onCreate 也用 ref，避免每次渲染重建 useEditor 的回调
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;

  // 无字数 UI 且无上限时不挂 CharacterCount，避免每键 Segmenter 开销
  const enableCharacterCount = showCharCount || maxLength != null;

  // === 3. 创建编辑器 ===
  const editor = useEditor({
    immediatelyRender: false,  // SSR 安全
    extensions: createExtensions({
      placeholder: placeholder ?? locale.placeholder,
      maxLength,
      characterCount: enableCharacterCount,
      extensions,
      extraExtensions,
      resolveImageSrcRef,
      showTitle,
      imageResize,
      tableResizable,
    }),
    // 有标题时归一化为 EMPTY_NOTE_DOC，保证结构合法
    content: showTitle
      ? normalizeNoteContent(content ?? defaultContent)
      : (content ?? defaultContent ?? ''),
    editable,
    autofocus,
    textDirection,
    editorProps: {
      attributes: {
        class: cn('tiptap focus:outline-none', editorClassName),
        lang: 'zh-CN',
      },
    },
    onCreate: ({ editor: e }) => {
      const focusBodyEnd = () => {
        if (e.isDestroyed) return;
        // 有 title 节点，或显式 autofocus=end：都钉到正文末尾
        if (
          autofocus === 'end' ||
          e.state.doc.firstChild?.type.name === 'title'
        ) {
          e.commands.focus('end');
        }
      };
      focusBodyEnd();
      // Title NodeView 挂载可能打乱选区，下一帧再钉到末尾
      // 双 rAF：第一帧 NodeView 挂载，第二帧选区稳定
      requestAnimationFrame(() => {
        focusBodyEnd();
        requestAnimationFrame(focusBodyEnd);
      });
      onCreateRef.current?.(e);
    },
    onUpdate: ({ editor: e }) => {
      const cb = onChangeRef.current;
      if (!cb) return;
      // 热路径不做 getJSON（学习笔记等只用 html/text/title）
      cb({
        html: e.getHTML(),
        text: e.getText({ blockSeparator: '\n\n' }),
        title: getDocTitleText(e.state.doc),
      });
    },
  });

  // === 4. 链接状态机 ===
  const link = useLinkEditor(editor);
  // 用 ref 把 link.draft 传给 shouldShowBubble（避免 useCallback 依赖变化）
  const linkDraftRef = useRef(link.draft);
  linkDraftRef.current = link.draft;

  // === 5. 气泡菜单显示条件 ===
  /** 仅有真实文本选区时显示；补回 TipTap 默认的空块判断，避免空段落误显 */
  const shouldShowBubble = useCallback(
    ({
      editor: e,
      view,
      state,
      from,
      to,
    }: {
      editor: Editor;
      view: { hasFocus: () => boolean };
      state: {
        doc: { textBetween: (a: number, b: number) => string };
        selection: { empty: boolean };
      };
      from: number;
      to: number;
    }) => {
      // 链接草稿打开时不显示气泡（避免和链接面板冲突）
      if (linkDraftRef.current || !e.isEditable) return false;
      // 编辑器无焦点不显示
      if (!view.hasFocus()) return false;
      const { doc, selection } = state;
      // 必须是文本选区、非空、有实际文本
      if (
        !isTextSelection(selection) ||
        selection.empty ||
        from === to ||
        !doc.textBetween(from, to).length
      ) {
        return false;
      }
      // 图片、代码块上不显示
      if (e.isActive('image') || e.isActive('codeBlock')) return false;
      return true;
    },
    [],
  );

  // === 6. editable 同步 ===
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // === 7. 受控内容同步 ===
  // 仅在外部 content 与当前不一致时写入，避免打断输入
  useEffect(() => {
    if (!editor || content === undefined) return;
    const next =
      typeof content === 'string' ? content : JSON.stringify(content);
    const current =
      typeof content === 'string'
        ? editor.getHTML()
        : JSON.stringify(editor.getJSON());
    // 内容一致就不写，避免光标跳
    if (next === current) return;
    editor.commands.setContent(normalizeNoteContent(content), {
      emitUpdate: false,  // 不触发 onUpdate，避免循环
    });
  }, [editor, content]);

  // === 8. EditorContext 共享 ===
  const ctx = useMemo(() => ({ editor }), [editor]);

  // === 9. toolbarExtra 支持 ReactNode 或 (editor) => ReactNode ===
  const extra = useMemo(() => {
    if (!editor) return null;
    return typeof toolbarExtra === 'function'
      ? toolbarExtra(editor)
      : toolbarExtra;
  }, [editor, toolbarExtra]);

  if (!editor) return null;

  return (
    <EditorContext.Provider value={ctx}>
      <div className={cn('rich-editor rounded-r-md', className)} lang="zh-CN">
        {/* 顶部工具栏 */}
        {showToolbar && (
          <Toolbar
            editor={editor}
            locale={locale}
            onUploadImage={onUploadImage}
            onOpenLink={link.open}
            linkOpen={!!link.draft}
            extra={extra}
          />
        )}

        {/* 链接输入面板（草稿打开时显示） */}
        {link.draft && (
          <LinkForm
            locale={locale}
            href={link.draft.href}
            onHrefChange={link.setHref}
            onApply={link.apply}
            onRemove={link.remove}
            onClose={link.close}
            // 空行时显示提示
            hint={link.draft.range ? undefined : locale.linkEmptyHint}
          />
        )}

        {/* 选区气泡菜单 */}
        {showBubbleMenu && (
          <BubbleMenu
            editor={editor}
            shouldShow={shouldShowBubble}
            options={{ placement: 'top', offset: 8, flip: true }}
          >
            <FormatBubble
              editor={editor}
              locale={locale}
              onOpenLink={link.open}
            />
          </BubbleMenu>
        )}

        {/* 正文区域（可滚动） */}
        <ScrollArea className="rich-editor-body" onScroll={onBodyScroll}>
          {renderBody ? (
            renderBody(<EditorContent editor={editor} spellCheck="false" />)
          ) : (
            <EditorContent editor={editor} spellCheck="false" />
          )}
        </ScrollArea>

        {/* 底部字数统计 */}
        {showCharCount && (
          <CharCount editor={editor} locale={locale} maxLength={maxLength} />
        )}
      </div>
    </EditorContext.Provider>
  );
}

export default RichEditor;
export type { Editor } from '@tiptap/react';
export type { CodeLanguage } from './code';
export { CODE_LANGUAGES } from './code';
export { createExtensions } from './extensions';
export type { ResolveImageSrc } from './image';
export { fileToDataUrl, pickImageFile } from './image';
export type { RichEditorLocale } from './locale';
export { enUS, richEditorLocaleOf, zhCN } from './locale';
export {
  EMPTY_NOTE_DOC,
  getDocTitleText,
  NoteTitleField,
  normalizeNoteContent,
  TitleNode,
} from './title';
export { Btn } from './toolbar';
export type {
  CreateExtensionsOptions,
  RichEditorChangePayload,
  RichEditorContent,
  RichEditorProps,
  TextDirection,
} from './types';
```

### 16.1 实现要点

- **`resolveImageSrcRef` / `onChangeRef` / `onCreateRef` 三重 ref**：把可变 props 接进不可变扩展与回调，避免每次渲染重建编辑器。这是把 Tiptap 用成「受控组件」的核心技巧。
- **`onUpdate` 热路径不调 `getJSON()`**：长文每键序列化 JSON 开销大，只回传 `html` / `text` / `title`。
- **`shouldShowBubble` 补判断**：TipTap 默认在空段落也显示气泡，这里补 `doc.textBetween(from, to).length` 判断，避免空选区误显。
- **受控同步的「内容一致不写」**：`setContent` 会重置选区导致光标跳，所以先比较 `next === current`，一致就跳过。
- **`emitUpdate: false`**：受控同步时不触发 `onUpdate`，避免「外部 setContent → onUpdate → 外部 setState → 再 setContent」的死循环。
- **双 rAF 聚焦**：Title NodeView 是 React 组件，挂载时机晚于 `onCreate`，所以用两次 `requestAnimationFrame` 等 NodeView 挂载完再聚焦。
- **`EditorContext.Provider`**：让子组件（如 `Toolbar`）能通过 `useContext` 拿到 editor，不必层层 props 传递。

---

## 17. 完整使用示例

### 17.1 最简用法（非受控）

```tsx
import { RichEditor } from '@/components/design/RichEditor';
import { useState } from 'react';

function NoteEditor() {
  const [html, setHtml] = useState('');

  return (
    <RichEditor
      defaultContent=""
      onChange={({ html, title, text }) => {
        setHtml(html);
        console.log('标题:', title);
      }}
    />
  );
}
```

### 17.2 受控用法（带保存）

```tsx
import { RichEditor } from '@/components/design/RichEditor';
import { useState } from 'react';

function ControlledEditor({ noteId }: { noteId: string }) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChange = async ({ html, title }) => {
    setContent(html);
    setSaving(true);
    await fetch(`/api/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({ html, title }),
    });
    setSaving(false);
  };

  return (
    <RichEditor
      content={content}
      onChange={handleChange}
      maxLength={10000}
      placeholder="写下你的想法…"
    />
  );
}
```

### 17.3 自定义图片上传（接 OSS / S3）

```tsx
import { RichEditor } from '@/components/design/RichEditor';

async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  const { url } = await res.json();
  return url;  // 返回远程 URL，编辑器里存的是 URL 而非 base64
}

function EditorWithUpload() {
  return <RichEditor onUploadImage={uploadImage} />;
}
```

### 17.4 工具栏尾部扩展（toolbarExtra）

```tsx
import { RichEditor } from '@/components/design/RichEditor';
import { Button } from '@/components/ui';

function EditorWithExtra() {
  return (
    <RichEditor
      toolbarExtra={(editor) => (
        <Button
          size="sm"
          onClick={() => editor.chain().focus().insertContent('🎬').run()}
        >
          插入表情
        </Button>
      )}
    />
  );
}
```

### 17.5 长文虚拟滚动用法（renderBody）

这是 `renderBody` prop 最复杂的用法：实现长文连续滚动编辑。下面给出**完整可用**的实现，包含 HTML 切块工具、文档模型、窗口切换逻辑与编辑器组件，可直接复制到项目中使用。

> 本节代码与仓库 `src/views/learning-notes/components/Editor.tsx` + `src/views/learning-notes/utils/doc.ts` 一致，是完整版而非简化版。第 19-20 章会逐行解释原理，本节聚焦「如何用」。

#### 17.5.1 依赖的 HTML 工具（previewHtml.ts 精简版）

切块前需要两个底层工具：剥离标题节点 + 按顶层标签切块。

```ts
// utils/previewHtml.ts（精简版，完整版见第 23 章）

/**
 * 去掉文档内嵌的 title 节点。
 * 用正则而非 DOMParser：大文档（含 base64 图）整树解析会卡主线程。
 * title 的 renderHTML 是单层 div，无嵌套同名闭合问题。
 */
export function stripNoteTitleHtml(html: string): string {
  if (!html) return '';
  return html.replace(
    /<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i,
    '',
  );
}

/**
 * 按顶层开闭标签切开（笔记多为扁平 p/h/ul/table）。
 * 正则解释：
 * - <([a-z][a-z0-9]*)  捕获标签名
 * - \b[^>]*             标签属性
 * - (?:\/>|>[\s\S]*?<\/\1>)  自闭合 或 开闭标签（[\s\S]*? 非贪婪跨行）
 *
 * 例：<p>段1</p><h2>标题</h2><ul><li>项</li></ul>
 *   → ['<p>段1</p>', '<h2>标题</h2>', '<ul><li>项</li></ul>']
 */
export function splitPreviewBlocks(html: string): string[] {
  if (!html) return [];
  const blocks: string[] = [];
  const re = /<([a-z][a-z0-9]*)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    // 标签之间的空白也当作块（避免丢失）
    if (m.index > last) {
      const gap = html.slice(last, m.index).trim();
      if (gap) blocks.push(gap);
    }
    blocks.push(m[0]);
    last = m.index + m[0].length;
  }
  // 尾部剩余
  if (last < html.length) {
    const tail = html.slice(last).trim();
    if (tail) blocks.push(tail);
  }
  return blocks.length ? blocks : [html];
}
```

#### 17.5.2 长文文档模型与窗口工具（doc.ts 完整版）

```ts
// utils/doc.ts
import { splitPreviewBlocks, stripNoteTitleHtml } from './previewHtml';

/** 超过该块数启用长文滚动窗口 */
export const LARGE_MIN_BLOCKS = 80;
/** 编辑器内正文块数（窗口大小） */
export const WINDOW_SIZE = 100;
/** origin 变化至少这么多块才换窗，减少抖动 */
export const ORIGIN_HYSTERESIS = 24;
/** 块高估算（px），用于撑高滚动条 */
export const EST_BLOCK_H = 44;

// 标题节点正则：匹配 <div data-type="note-title" ...>...</div>
const TITLE_RE =
  /<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i;

/**
 * 长文文档模型：
 * - blocks: 切好的块级 HTML 数组（不含标题）
 * - origin: 当前窗口起点（blocks 数组的索引）
 * - count: 当前窗口块数（<= WINDOW_SIZE）
 */
export type LargeNoteDoc = {
  blocks: string[];
  origin: number;
  count: number;
};

/** 从 HTML 中提取 title 节点 HTML */
export function extractTitleHtml(html: string): string {
  return html.match(TITLE_RE)?.[0] ?? '';
}

/**
 * 从 HTML 中提取标题纯文本
 * 优先读 data-value 属性（NodeView 写入的值），兜底 textContent
 */
export function extractTitleText(html: string): string {
  const node = extractTitleHtml(html);
  if (!node) return '';
  const fromAttr = node.match(/data-value=["']([^"']*)["']/i)?.[1];
  if (fromAttr != null) return fromAttr.trim();
  return node.replace(/<[^>]+>/g, '').trim();
}

/** 标题文本 → title 节点 HTML（写回时用） */
export function titleToHtml(title: string): string {
  // 转义：避免标题里的 HTML 字符破坏结构
  const safe = title
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div data-type="note-title" data-value="${safe}">${safe}</div>`;
}

/**
 * 判断是否需要走长文路径：
 * - HTML 长度 >= 80_000 字符
 * - 或正文块数 >= 80
 * 两个条件任一满足即判定为长文
 */
export function isLargeNoteHtml(content: unknown): content is string {
  if (typeof content !== 'string' || !content) return false;
  const body = stripNoteTitleHtml(content);
  if (content.length >= 80_000) return true;
  return splitPreviewBlocks(body).length >= LARGE_MIN_BLOCKS;
}

/**
 * 初始化长文文档模型：
 * 1. 抽出标题
 * 2. 剥离标题后的正文按块切开
 * 3. 初始 origin=0，count=min(WINDOW_SIZE, blocks.length)
 * 4. editorHtml 是初始窗口的 HTML（用于挂载 TipTap）
 */
export function createLargeNoteDoc(html: string): {
  doc: LargeNoteDoc;
  title: string;
  editorHtml: string;
} {
  const title = extractTitleText(html);
  const body = stripNoteTitleHtml(html);
  const parts = splitPreviewBlocks(body);
  // 空文档兜底一个空段
  const blocks = parts.length ? parts : ['<p></p>'];
  const count = Math.min(WINDOW_SIZE, blocks.length);
  const doc: LargeNoteDoc = { blocks, origin: 0, count };
  return {
    doc,
    title,
    // 初始窗口 HTML（用于挂载 TipTap）
    editorHtml: blocks.slice(0, count).join('') || '<p></p>',
  };
}

/**
 * 判断编辑器返回的 HTML 是否「实质为空」：
 * - 0 块
 * - 或 <= 3 块且全是 <p></p>
 * 用于 flushWindow 时拒绝空覆盖（避免误把全文清空）
 */
function isEffectivelyEmptyBody(blocks: string[]): boolean {
  if (blocks.length === 0) return true;
  if (blocks.length > 3) return false;
  return blocks.every((b) => /^<p\b[^>]*>\s*<\/p>$/i.test(b));
}

/**
 * 写回当前窗口：
 * 1. 把 editorHtml 按块切开
 * 2. 用切好的块替换 doc.blocks[origin .. origin+count]
 * 3. 更新 count 为新块数
 * @returns 是否写回成功（空覆盖时返回 false）
 */
export function flushWindow(doc: LargeNoteDoc, editorHtml: string): boolean {
  const bodyBlocks = splitPreviewBlocks(stripNoteTitleHtml(editorHtml));
  // 空覆盖守卫：编辑器看起来空了，但全文不该空，拒绝写回
  if (isEffectivelyEmptyBody(bodyBlocks) && doc.count > 3) return false;
  const next = bodyBlocks.length ? bodyBlocks : ['<p></p>'];
  // splice 替换：删除 origin..origin+count，插入 next
  doc.blocks.splice(doc.origin, doc.count, ...next);
  doc.count = next.length;
  return true;
}

/**
 * 取出指定 origin 起的窗口 HTML：
 * - count = min(WINDOW_SIZE, blocks.length - origin)
 * - html = blocks.slice(origin, origin+count).join('')
 */
export function windowBodyHtml(
  doc: LargeNoteDoc,
  origin: number,
): { html: string; count: number } {
  const count = Math.min(WINDOW_SIZE, Math.max(0, doc.blocks.length - origin));
  const html =
    count > 0 ? doc.blocks.slice(origin, origin + count).join('') : '<p></p>';
  return { html, count: count > 0 ? count : 1 };
}

/**
 * 由滚动位置算窗口 origin（居中可视区）：
 * 1. center = scrollTop + viewH / 2（可视中心）
 * 2. centerIdx = center / EST_BLOCK_H（中心对应的块索引）
 * 3. origin = centerIdx - WINDOW_SIZE/2（让窗口居中覆盖可视区）
 * 4. clamp 到 [0, maxOrigin]
 */
export function originForScroll(
  scrollTop: number,
  viewH: number,
  blockCount: number,
  estH: number,
): number {
  const center = scrollTop + viewH / 2;
  const centerIdx = Math.max(
    0,
    Math.min(blockCount - 1, Math.floor(center / estH)),
  );
  const maxOrigin = Math.max(0, blockCount - WINDOW_SIZE);
  return Math.max(
    0,
    Math.min(maxOrigin, centerIdx - Math.floor(WINDOW_SIZE / 2)),
  );
}

/**
 * 拼接全文 HTML（用于保存）：
 * 1. flushWindow 把当前窗口写回
 * 2. 标题 + blocks.join('') 拼成完整 HTML
 */
export function stitchFullHtml(
  doc: LargeNoteDoc,
  title: string,
  editorHtml: string,
): string {
  flushWindow(doc, editorHtml);
  return `${titleToHtml(title)}${doc.blocks.join('')}`;
}

/**
 * 拼接全文纯文本（用于搜索/摘要）：
 * 1. flushWindow 写回
 * 2. 标题 + 正文 HTML
 * 3. <br> → \n，</p> → \n\n，去标签，合并多余空行
 */
export function stitchFullText(
  doc: LargeNoteDoc,
  title: string,
  editorHtml: string,
): string {
  flushWindow(doc, editorHtml);
  const full = `${titleToHtml(title)}${doc.blocks.join('')}`;
  return full
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

#### 17.5.3 长文编辑器组件（LargeNoteEditor 完整版）

```tsx
// components/LargeNoteEditor.tsx
import {
  type Editor,
  NoteTitleField,
  RichEditor,
  type RichEditorLocale,
  type RichEditorProps,
} from '@/components/design/RichEditor';
import {
  type ReactNode,
  type UIEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';
import {
  createLargeNoteDoc,
  EST_BLOCK_H,
  flushWindow,
  type LargeNoteDoc,
  ORIGIN_HYSTERESIS,
  originForScroll,
  stitchFullHtml,
  stitchFullText,
  WINDOW_SIZE,
  windowBodyHtml,
} from '../utils/doc';

/**
 * 保存 API：供外层调用，获取全文 HTML / 纯文本 / 标题。
 * 注意：getHTML 必须调 stitchFullHtml 拼接全文，不能只返回当前窗口。
 */
export type LargeNoteSaveApi = {
  getHTML: () => string;
  getText: () => string;
  getTitle: () => string;
};

type Props = {
  defaultContent: string;
  locale: Partial<RichEditorLocale>;
  placeholder?: string;
  toolbarExtra?: RichEditorProps['toolbarExtra'];
  className?: string;
  editorClassName?: string;
  /** 编辑器就绪回调，返回 editor 实例与 save API */
  onReady: (editor: Editor, save: LargeNoteSaveApi) => void;
};

/**
 * 初始化长文文档：
 * 1. createLargeNoteDoc 切块
 * 2. 进编辑要对齐短文「光标在文末」：初始就挂最后一窗
 *    避免挂第一窗后 focus(end) 停在全文中段（视觉上像挂错位置）
 */
function bootLargeNote(defaultContent: string) {
  const created = createLargeNoteDoc(defaultContent);
  const maxOrigin = Math.max(0, created.doc.blocks.length - WINDOW_SIZE);
  if (maxOrigin > 0) {
    const { html, count } = windowBodyHtml(created.doc, maxOrigin);
    created.doc.origin = maxOrigin;
    created.doc.count = count;
    created.editorHtml = html;
  }
  return created;
}

/**
 * 滚动到正文底部 + 焦点文末：
 * - 找到 ScrollArea 的 viewport 元素（data-slot="scroll-area-viewport"）
 * - 设置 scrollTop = scrollHeight
 * - editor.commands.focus('end')
 * 双重保证：DOM 滚动 + ProseMirror 选区
 */
function scrollViewportToEnd(editor: Editor) {
  const vp = editor.view.dom.closest(
    '[data-slot="scroll-area-viewport"]',
  ) as HTMLElement | null;
  if (vp) vp.scrollTop = vp.scrollHeight;
  if (!editor.isDestroyed) editor.commands.focus('end');
}

/**
 * 长笔记连续滚动编辑。
 * 标题与短文共用 NoteTitleField，自然文档流紧贴正文
 * （勿用固定 TITLE 槽高，否则会留大缝）。
 *
 * 核心思路：
 * 1. 把全文切成块数组，编辑器只挂当前窗口的 ~100 块
 * 2. 用 translateY 制造「内容很多」的滚动假象
 * 3. 滚动时 flushWindow 写回当前窗口、windowBodyHtml 取下一窗口、setContent 切换
 * 4. 保存时 stitchFullHtml 拼接全文
 */
export function LargeNoteEditor({
  defaultContent,
  locale,
  placeholder,
  toolbarExtra,
  className,
  editorClassName,
  onReady,
}: Props) {
  // === 1. boot：初始化文档模型（只跑一次）===
  // useRef 保证 createLargeNoteDoc 只在挂载时跑一次，避免每次渲染都切块
  const boot = useRef(bootLargeNote(defaultContent));
  const docRef = useRef<LargeNoteDoc>(boot.current.doc);
  const editorRef = useRef<Editor | null>(null);

  // === 2. 标题相关 ref ===
  // 标题高度（用于算滚动时扣除标题区，标题在文档流里，scrollTop 包含标题区）
  const titleWrapRef = useRef<HTMLDivElement | null>(null);
  const titleHRef = useRef(0);
  const [title, setTitle] = useState(boot.current.title);
  // titleRef：让 saveApi 闭包始终读最新 title，避免 useCallback 依赖 title 重建
  const titleRef = useRef(title);
  titleRef.current = title;

  // === 3. 窗口相关 ref ===
  const originRef = useRef(boot.current.doc.origin);
  // shiftingRef：切窗过程中标志位，避免 onScroll 在切窗时重复触发
  const shiftingRef = useRef(false);
  // scrollRafRef：滚动节流，requestAnimationFrame id
  const scrollRafRef = useRef(0);

  // onReady ref：避免 useCallback 依赖 onReady 重建
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // === 4. 渲染状态：blockCount 和 offsetY 触发重渲染 ===
  const [blockCount, setBlockCount] = useState(boot.current.doc.blocks.length);
  const [offsetY, setOffsetY] = useState(boot.current.doc.origin * EST_BLOCK_H);
  /**
   * 块数不足一窗时勿按 WINDOW_SIZE 垫高
   * （大图笔记常因 base64 进长文路径，否则文末巨空白）
   */
  const windowed = blockCount > WINDOW_SIZE;
  const bodyH = Math.max(blockCount, 1) * EST_BLOCK_H;

  // === 5. 测量标题高度：标题可能换行（如 50 字标题），用 ResizeObserver 跟踪 ===
  useLayoutEffect(() => {
    const el = titleWrapRef.current;
    if (!el) return;
    const sync = () => {
      titleHRef.current = el.offsetHeight;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // === 6. saveApi：供外层保存 ===
  // useCallback 空依赖：闭包通过 ref 读最新值，避免每次渲染重建
  const saveApi = useCallback((): LargeNoteSaveApi => {
    return {
      getHTML: () => {
        const e = editorRef.current;
        const html = e && !e.isDestroyed ? e.getHTML() : '';
        // 必须先 flushWindow 再拼接，否则当前窗口编辑结果丢失
        return stitchFullHtml(docRef.current, titleRef.current, html);
      },
      getText: () => {
        const e = editorRef.current;
        const html = e && !e.isDestroyed ? e.getHTML() : '';
        return stitchFullText(docRef.current, titleRef.current, html);
      },
      getTitle: () => titleRef.current.trim(),
    };
  }, []);

  // === 7. 标题 Enter/Tab → 聚焦正文 ===
  const focusBody = useCallback(() => {
    editorRef.current?.commands.focus('start');
  }, []);

  // === 8. applyOrigin：切换窗口核心逻辑 ===
  const applyOrigin = useCallback((editor: Editor, nextOrigin: number) => {
    const doc = docRef.current;
    // 切窗中或 origin 未变：直接返回
    if (shiftingRef.current) return;
    if (nextOrigin === originRef.current) return;

    const maxOrigin = Math.max(0, doc.blocks.length - WINDOW_SIZE);
    // snapEdge：贴边时强制切窗（避免贴边卡在 hysteresis 内）
    const snapEdge =
      (nextOrigin === 0 && originRef.current !== 0) ||
      (nextOrigin === maxOrigin && originRef.current !== maxOrigin);
    // hysteresis：非贴边时变化小于 ORIGIN_HYSTERESIS 不切窗，减少抖动
    if (
      !snapEdge &&
      Math.abs(nextOrigin - originRef.current) < ORIGIN_HYSTERESIS
    ) {
      return;
    }

    shiftingRef.current = true;
    try {
      // 1. flushWindow：把当前窗口编辑结果写回 doc.blocks
      flushWindow(doc, editor.getHTML());
      // 2. windowBodyHtml：取下一窗口的 HTML
      const { html, count } = windowBodyHtml(doc, nextOrigin);
      // 3. setContent：切换编辑器内容（emitUpdate: false 避免触发 onUpdate）
      const ok = editor.commands.setContent(html, { emitUpdate: false });
      if (ok === false) return;
      // 4. 更新 doc 模型与 ref
      doc.origin = nextOrigin;
      doc.count = count;
      originRef.current = nextOrigin;
      // 5. 更新渲染状态（触发 translateY 重算）
      setOffsetY(nextOrigin * EST_BLOCK_H);
      setBlockCount(doc.blocks.length);
    } finally {
      // 下一帧解除 shifting 锁，避免 onScroll 在 setContent 过程中重入
      requestAnimationFrame(() => {
        shiftingRef.current = false;
      });
    }
  }, []);

  // === 9. onBodyScroll：滚动监听 ===
  const onBodyScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const editor = editorRef.current;
      // 编辑器未就绪 / 切窗中：跳过
      if (!editor || editor.isDestroyed || shiftingRef.current) return;
      const vp = e.currentTarget;
      // 扣除标题高度：标题在文档流里，scrollTop 包含标题区
      const titleH =
        titleHRef.current || titleWrapRef.current?.offsetHeight || 0;
      const top = Math.max(0, vp.scrollTop - titleH);
      const viewH = vp.clientHeight || 600;
      // 节流：当前帧已有 raf 排队，跳过
      if (scrollRafRef.current) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        if (shiftingRef.current) return;
        // 算出下一窗口 origin
        const next = originForScroll(
          top,
          viewH,
          docRef.current.blocks.length,
          EST_BLOCK_H,
        );
        applyOrigin(editor, next);
      });
    },
    [applyOrigin],
  );

  // === 10. renderBody：包裹 EditorContent ===
  // 这是 renderBody prop 的核心用法：在 EditorContent 外套标题 + 绝对定位偏移
  const renderBody = useCallback(
    (editorContent: ReactNode) => (
      <div className="relative w-full">
        {/* 文档流标题：与短文 TipTap node-title 同距，mb-2 即空隙 */}
        <div ref={titleWrapRef} className="relative z-1">
          <NoteTitleField
            value={title}
            onChange={setTitle}
            onContinue={focusBody}
          />
        </div>
        {windowed ? (
          // 长文：绝对定位 + translateY 制造滚动假象
          // 外层 div 高度 = 全文块数 * EST_BLOCK_H，撑高滚动条
          <div className="relative w-full" style={{ height: bodyH }}>
            {/* 内层 div 用 translateY 偏移到当前窗口位置 */}
            <div
              className="absolute top-0 right-0 left-0"
              style={{ transform: `translateY(${offsetY}px)` }}
            >
              {editorContent}
            </div>
          </div>
        ) : (
          // 短文：直接文档流（避免不足一窗时撑高出现巨空白）
          <div className="relative w-full">{editorContent}</div>
        )}
      </div>
    ),
    [bodyH, focusBody, offsetY, title, windowed],
  );

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col', className)}>
      <RichEditor
        defaultContent={boot.current.editorHtml}
        // 关闭内置标题：标题由 renderBody 外层 NoteTitleField 渲染
        showTitle={false}
        // 关闭自动聚焦：由 LargeNoteEditor 在 onCreate 后用双 rAF 控制
        autofocus={false}
        placeholder={placeholder}
        locale={locale}
        // 长文不显示字数（CharacterCount 在大文档上有 Segmenter 开销）
        showCharCount={false}
        // 长文不显示气泡（选区气泡在切窗时定位会乱）
        showBubbleMenu={false}
        onBodyScroll={onBodyScroll}
        renderBody={renderBody}
        onCreate={(e) => {
          editorRef.current = e;
          docRef.current.origin = originRef.current;
          onReadyRef.current(e, saveApi());
          // 布局完成后再滚到底 + 焦点文末
          // 双 rAF：第一帧 EditorContent 挂载，第二帧 offset 生效
          requestAnimationFrame(() => {
            scrollViewportToEnd(e);
            requestAnimationFrame(() => scrollViewportToEnd(e));
          });
        }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        editorClassName={editorClassName}
        toolbarExtra={toolbarExtra}
      />
    </div>
  );
}
```

#### 17.5.4 renderBody prop 的协作方式

`renderBody` 是 RichEditor 提供的「自定义正文包裹」出口，长文场景下与另外两个 prop 协作：

| RichEditor prop | 值 | 作用 |
|---|---|---|
| `showTitle` | `false` | 关闭内置 TitleNode，标题由 `renderBody` 外层 `NoteTitleField` 渲染，避免双标题 |
| `renderBody` | `(content) => <标题 + 绝对定位容器>{content}</...>` | 在 `EditorContent` 外套标题 + 绝对定位偏移，用 `translateY` 制造滚动假象 |
| `onBodyScroll` | `(e) => applyOrigin(...)` | 监听 ScrollArea 滚动，根据 `scrollTop` 算当前应该显示哪个窗口，调用 `editor.commands.setContent` 切换 |
| `autofocus` | `false` | 关闭自动聚焦，由外层在 `onCreate` 后用双 rAF 控制滚动到文末 |
| `showCharCount` | `false` | CharacterCount 在大文档上有 Segmenter 开销，关闭 |
| `showBubbleMenu` | `false` | 切窗时气泡定位会乱，关闭 |
| `defaultContent` | `boot.editorHtml` | 初始窗口 HTML（非全文，只挂当前窗口的 ~100 块） |

#### 17.5.5 数据流示意

```
挂载时：
  defaultContent (全文 HTML)
    ↓ createLargeNoteDoc
  doc.blocks = [<p>块1</p>, <h2>块2</h2>, ...]   ← 切成数组
  boot.editorHtml = blocks[origin..origin+WINDOW_SIZE].join('')  ← 初始窗口
    ↓ RichEditor defaultContent
  TipTap 只挂载当前窗口的 ~100 块

滚动时：
  onBodyScroll(scrollTop)
    ↓ 扣除标题高度
    ↓ originForScroll 算出 nextOrigin
    ↓ applyOrigin:
      1. flushWindow(doc, editor.getHTML())   ← 写回当前窗口编辑结果
      2. windowBodyHtml(doc, nextOrigin)       ← 取下一窗口 HTML
      3. editor.commands.setContent(html, { emitUpdate: false })  ← 切换
      4. setOffsetY(nextOrigin * EST_BLOCK_H)  ← 更新 translateY
    ↓ renderBody 重渲染
  TipTap 显示新窗口的 ~100 块

保存时：
  saveApi.getHTML()
    ↓ editor.getHTML()                         ← 取当前窗口 HTML
    ↓ stitchFullHtml(doc, title, editorHtml)
      1. flushWindow(doc, editorHtml)          ← 先写回当前窗口
      2. titleToHtml(title) + doc.blocks.join('')  ← 拼接全文
    ↓ 返回完整 HTML
```

#### 17.5.6 完整使用示例

```tsx
// 在业务组件中使用 LargeNoteEditor
import { LargeNoteEditor, type LargeNoteSaveApi } from './components/LargeNoteEditor';
import { type Editor, richEditorLocaleOf } from '@/components/design/RichEditor';
import { useRef, useState } from 'react';

function NoteEditorPage({ initialHtml, locale }: {
  initialHtml: string;
  locale: 'zh-CN' | 'en-US';
}) {
  const editorRef = useRef<Editor | null>(null);
  const saveRef = useRef<LargeNoteSaveApi | null>(null);

  const handleSave = async () => {
    if (!saveRef.current) return;
    const html = saveRef.current.getHTML();  // 拼接全文
    const text = saveRef.current.getText();  // 全文纯文本
    const title = saveRef.current.getTitle();
    await fetch('/api/notes', {
      method: 'PUT',
      body: JSON.stringify({ html, text, title }),
    });
  };

  return (
    <div className="h-full flex flex-col">
      <button onClick={handleSave}>保存</button>
      <LargeNoteEditor
        defaultContent={initialHtml}
        locale={richEditorLocaleOf(locale)}
        placeholder="开始输入…"
        onReady={(editor, save) => {
          editorRef.current = editor;
          saveRef.current = save;
        }}
        className="flex-1"
      />
    </div>
  );
}
```

#### 17.5.7 关键点小结

- **`showTitle={false}`**：关闭内置 TitleNode，标题由外层 `NoteTitleField` 渲染，避免双标题。
- **`renderBody` 包裹 EditorContent**：在 `EditorContent` 外套一层绝对定位容器，外层 `height = blockCount * EST_BLOCK_H` 撑高滚动条，内层 `translateY(offsetY)` 偏移到当前窗口位置。
- **`onBodyScroll` 切窗口**：监听 ScrollArea 滚动，扣除标题高度后用 `originForScroll` 算下一窗口，调用 `applyOrigin` 完成切窗。
- **`applyOrigin` 五步**：`flushWindow` 写回 → `windowBodyHtml` 取窗 → `setContent` 切换 → 更新 doc 模型 → 更新 translateY。
- **`emitUpdate: false`**：切窗时 `setContent` 不触发 `onUpdate`，避免「切窗 → onChange → 外层 setState → 再渲染」的循环。
- **`shiftingRef` 锁 + `scrollRafRef` 节流**：避免切窗过程中 `onScroll` 重入、避免高频滚动触发多次切窗。
- **`ORIGIN_HYSTERESIS` + `snapEdge`**：非贴边时变化小于 24 块不切窗减少抖动；贴边时强制切窗避免卡住。
- **`saveApi` 用 `useCallback` 空依赖 + ref**：闭包通过 `docRef` / `titleRef` / `editorRef` 读最新值，避免每次 title 变化重建 saveApi。
- **双 rAF 滚到底**：`onCreate` 时 `EditorContent` 还没挂载完，直接 `focus('end')` 会停在窗口中段。双 rAF 等绝对定位 offset 生效后再滚。
- **`boot` 用 `useRef`**：`createLargeNoteDoc` 切块只跑一次，不触发重渲染。
- **`windowed` 判断**：块数不足 `WINDOW_SIZE` 时直接走文档流，避免不足一窗时撑高出现「文末巨空白」。

> **原理详解**：第 19 章逐行解释 `doc.ts` 的切块与窗口工具，第 20 章逐行解释 `LargeNoteEditor` 的切窗逻辑与 ref 模式。本节聚焦「完整可用代码」，原理章节聚焦「为什么这么写」。

---

## 18. 验收清单

按本手册实现完成后，用以下清单逐项验收，确保功能与原编辑器一致。

### 18.1 基础能力

- [ ] 空编辑器打开时，光标自动落在正文末尾（不是标题里）。
- [ ] 标题 input 输入中文时，IME 组合过程不跳光标，组合结束才提交。
- [ ] 标题 input 按 Enter / Tab 跳到正文末尾。
- [ ] 标题 input 字数上限 50，超出不能输入。
- [ ] `Mod-a` 只选正文，不包含标题。
- [ ] 空内容时显示占位符「开始输入…」；空标题块不显示占位符。

### 18.2 文档结构守卫

- [ ] 删除所有正文段落后，会自动补一个空段（不会只剩标题）。
- [ ] 粘贴包含多个 `<div data-type="note-title">` 的 HTML，只保留首位一个，其余转成段落。
- [ ] 标题后紧跟图片时，光标能落在图片前的空段（GapCursor 合法）。
- [ ] 空段落上 Backspace（光标在段首）能删除该段，不会卡住。
- [ ] 空段落上 Delete（光标在段尾）能删除该段，不会卡住。

### 18.3 行内格式

- [ ] 粗体 / 斜体 / 下划线 / 删除线 / 行内代码 / 高亮 都能 toggle，激活态正确高亮。
- [ ] 多个 mark 可叠加（如粗体 + 斜体 + 高亮）。
- [ ] 清除格式按钮能清除所有 marks 与节点格式。
- [ ] 代码块内不显示气泡菜单。
- [ ] 图片上不显示气泡菜单。

### 18.4 块级格式

- [ ] H1-H5 标题切换，下拉触发器图标随当前级别变化。
- [ ] 无序 / 有序 / 任务列表切换，Tab 下沉、Shift-Tab 提升。
- [ ] 任务列表项勾选框可点击切换。
- [ ] 引用块、代码块、分隔线插入正常。
- [ ] 代码块语言选择器只在光标在代码块时出现，切换语言后高亮立即更新。
- [ ] 文本对齐（左 / 中 / 右 / 两端）对段落和标题生效。

### 18.5 链接

- [ ] 选中文字点链接按钮，输入 URL 后确定，文字变成链接。
- [ ] 光标在已有链接内点链接按钮，输入框预填当前 href，可改可删。
- [ ] 光标在普通词上点链接按钮，扩展到整个词。
- [ ] 空行点链接按钮，显示「请先选中文字」提示，确定按钮禁用。
- [ ] 输入 `example.com` 自动补成 `https://example.com`。
- [ ] 输入 `mailto:foo@bar.com` 保留 `mailto:` 协议。
- [ ] 移除链接按钮只在光标在链接内时可用。
- [ ] 链接面板按 Enter 应用、按 Escape 关闭。

### 18.6 图片

- [ ] 工具栏选图按钮弹出系统文件选择器，选图后插入。
- [ ] 粘贴剪贴板图片（如截图）自动插入。
- [ ] 拖放本地图片文件到编辑器自动插入。
- [ ] 编辑器内部拖动已有图片（移动位置）不被当成上传。
- [ ] WebP / AVIF 图片自动转 JPEG data URL。
- [ ] JPEG / PNG / GIF 保留原格式。
- [ ] `onUploadImage` 传入时，三入口（选图 / 粘贴 / 拖放）都走自定义上传。
- [ ] `onUploadImage` 变化时无需重建编辑器（动态切换上传实现）。

### 18.7 表格

- [ ] 插入 3x3 表格带表头。
- [ ] 光标在表格内时工具栏出现「+列 / +行 / 删表」按钮。
- [ ] 加列、加行、删表操作正常。
- [ ] `tableResizable` 开启后可拖拽列宽。

### 18.8 字数统计

- [ ] 底部显示「词数」和「字符数」。
- [ ] 中文字符按字数计入「词数」。
- [ ] 英文按空格分词计入「词数」。
- [ ] Emoji 按 grapheme 计数（👨‍👩‍👧 算 1 个字符）。
- [ ] 设 `maxLength` 后超限标红，显示「已达字数上限」。
- [ ] `showCharCount={false}` 且不传 `maxLength` 时不挂 CharacterCount（无 Segmenter 开销）。

### 18.9 工具栏响应式

- [ ] 窗口缩小时按钮自动收进「更多」下拉。
- [ ] 窗口放大时按钮自动从「更多」回到工具栏。
- [ ] 「更多」下拉里的按钮功能与内联按钮一致。
- [ ] 代码块语言选择器、表格操作按钮是条件项，只在对应场景出现。
- [ ] `toolbarExtra` 渲染在工具栏尾部，不参与溢出计算。

### 18.10 受控与非受控

- [ ] 非受控（`defaultContent`）：输入不触发外部重渲染，编辑器内部状态自洽。
- [ ] 受控（`content`）：外部 `content` 变化时编辑器同步，且内容一致时不写入（不打断输入）。
- [ ] `editable={false}` 切到只读，`editable={true}` 切回可编辑。
- [ ] `onChange` 回调收到 `{ html, text, title }`，不包含 `json`（除非调用方自行取）。

### 18.11 扩展性

- [ ] `extraExtensions` 追加的扩展生效（如自定义 Mention）。
- [ ] `extensions` 完全替换默认扩展列表。
- [ ] `toolbarExtra` 支持 `ReactNode` 和 `(editor) => ReactNode` 两种形式。
- [ ] `locale` 传 `Partial` 只覆盖指定键，其余走中文默认。

### 18.12 长文虚拟滚动

- [ ] `showTitle={false}` + `renderBody` 能正常渲染外层标题。
- [ ] `onBodyScroll` 能拿到滚动事件并切换窗口。
- [ ] 窗口切换时 `setContent` 不触发 `onUpdate`（`emitUpdate: false`）。
- [ ] 保存时 `getHTML()` 拼接的是全文（当前窗口 + 缓存的其余块），不是当前窗口片段。

---

## 附录：模块依赖图

```
                          ┌─────────────┐
                          │  types.ts   │ ← 类型契约
                          └──────┬──────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
        ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
        │ locale.ts │     │  image.ts  │    │ linkRange  │
        │ (文案)    │     │ (纯函数)   │    │ .ts (选区) │
        └─────┬─────┘     └──────┬──────┘    └──────┬──────┘
              │                  │                  │
              │           ┌──────▼──────┐    ┌──────▼──────┐
              │           │ImageUpload │    │  LinkForm  │
              │           │ .ts (扩展) │    │  .tsx (面板)│
              │           └──────┬──────┘    └──────┬──────┘
              │                  │                  │
        ┌─────▼──────────────────▼──────────────────▼─────┐
        │           extensions/index.ts                   │
        │  (TabIndent + CustomDocument + 组装所有扩展)      │
        └──────────────────────┬──────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  title/TitleNode.ts │ ← 自定义 Node
                    │  (atom + 结构守卫)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  title/Title.tsx    │ ← NodeView
                    │  + NoteTitleField   │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────▼──────────────────────────┐
        │              toolbar/Toolbar.tsx                 │
        │  (响应式溢出 + useEditorState + 所有按钮)         │
        └──────────────────────┬──────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  toolbar/FormatBubble│
                    │  .tsx (气泡)        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   index.tsx         │ ← 主组件：编排一切
                    │   (RichEditor)     │
                    └─────────────────────┘
```

---

## 结语

本手册覆盖了 `src/components/design/RichEditor/` 的全部实现，包括：

1. **类型契约**与**国际化**（第 3-4 章）
2. **样式系统**与主题变量（第 5 章）
3. **自定义 TitleNode**：atom + NodeView + appendTransaction 结构守卫（第 6-7 章）
4. **空段落删除修复**（第 8 章）
5. **图片三入口**：选图 / 粘贴 / 拖放 + 格式归一（第 9-10 章）
6. **链接状态机**：选区解析 + 面板 + IME 兼容（第 11 章）
7. **扩展组装**：TabIndent + CustomDocument + CharacterCount CJK 优化（第 13 章）
8. **响应式工具栏**：测量行 + ResizeObserver + 条件项（第 14 章）
9. **选区气泡**（第 15 章）
10. **主组件编排**：三重 ref 模式 + 受控同步 + 双 rAF 聚焦（第 16 章）
11. **长文虚拟滚动**用法（第 17.5 章）

按章节顺序实现，每完成一章都可独立验收。遇到问题回看对应章节的「实现要点」，能定位大多数坑。祝复刻顺利。

---

# 第二部分：长文本编辑与长文本预览

> 当笔记字数超过数万字（含 base64 图片）时，TipTap 把整篇 HTML 一次性挂到 ProseMirror 会卡死主线程：DOM 节点太多 + ProseMirror 解析整树 + 每键事务扫描全文。这一部分讲解仓库如何用「窗口化（windowing）」思路实现长文编辑与长文预览，让数万字笔记也能流畅编辑。
>
> 阅读顺序：先读第 19 章 HTML 切块工具（基础），再读第 20 章长文编辑器，最后读第 21 章长文预览。

## 目录（第二部分）

19. [HTML 切块与窗口工具 utils/doc.ts](#19-html-切块与窗口工具-utilsdocts)
20. [长文本编辑器 LargeNoteEditor](#20-长文本编辑器-largenoteeditor)
21. [长文本预览 WindowedPreviewBody](#21-长文本预览-windowedpreviewbody)
22. [短文/长文自动切换（learning-notes/index.tsx）](#22-短文长文自动切换-learning-notesindextsx)
23. [预览 HTML 处理工具 NotePreview/previewHtml.ts](#23-预览-html-处理工具-notepreviewpreviewhtmlts)
24. [只读预览组件 NotePreview](#24-只读预览组件-notepreview)
25. [长文本模块验收清单](#25-长文本模块验收清单)

---

## 18. 长文背景与窗口化思路

### 18.1 为什么需要窗口化？

TipTap 编辑器在短文（几百块以内）下表现良好，但笔记内容超过约 80 个块或 80KB HTML 时会出现明显卡顿：

- **挂载卡顿**：ProseMirror `DOMParser.parseSlice` 需要遍历整棵 DOM 树构建文档模型，数万字 + 多张 base64 图片时主线程冻结数秒。
- **每键卡顿**：每次按键产生一个 transaction，ProseMirror 要在整篇文档上做 `appendTransaction`、`scrollIntoView`、`stateField` 等扫描。
- **左侧列表滚动卡顿**：编辑器大 DOM 与左侧列表同屏，浏览器布局/绘制连锁拖垮列表滚动。
- **预览卡顿**：只读预览同样把整篇 HTML 挂到 DOM，大 base64 图片同时解码会触发主线程解码。

### 18.2 窗口化思路

借鉴虚拟滚动（virtualization）思路，但**编辑器不像列表那样可以「行级 React 渲染」**——TipTap 是把整篇 HTML 一次挂载到 ProseMirror。所以采用「块级窗口」方案：

```
全文 HTML
├── <div data-type="note-title">…</div>     ← 标题（单独抽出）
├── <p>第 1 块</p>                          ← block[0]
├── <h2>第 2 块</h2>                        ← block[1]
├── <ul><li>第 3 块</li></ul>               ← block[2]
├── ...                                     ← block[3..N-1]
└── <p>第 N 块</p>                          ← block[N-1]

编辑器只挂 block[origin .. origin+WINDOW_SIZE]：
┌─────────────────────────────────────┐
│  顶部 padding (origin * EST_BLOCK_H) │  ← 绝对定位 + translateY 制造空白
├─────────────────────────────────────┤
│  TipTap 编辑器（窗口内 ~100 块）      │  ← 实际可编辑
├─────────────────────────────────────┤
│  底部 padding (剩余块 * EST_BLOCK_H)  │  ← 绝对定位撑高滚动条
└─────────────────────────────────────┘

滚动时：
1. ResizeObserver / onScroll 算出当前可视中心对应的 origin
2. flushWindow：把当前窗口的编辑结果写回 doc.blocks[oldOrigin..]
3. windowBodyHtml：取出 block[newOrigin..] 拼 HTML
4. editor.commands.setContent(html, { emitUpdate: false }) 切换窗口
5. translateY 更新顶部偏移
```

### 18.3 关键常量

```ts
// src/views/learning-notes/utils/doc.ts
/** 超过该块数启用长文滚动窗口 */
export const LARGE_MIN_BLOCKS = 80;
/** 编辑器内正文块数 */
export const WINDOW_SIZE = 100;
/** origin 变化至少这么多块才换窗，减少抖动 */
export const ORIGIN_HYSTERESIS = 24;
/** 块高估算（px） */
export const EST_BLOCK_H = 44;
```

- **`LARGE_MIN_BLOCKS = 80`**：低于 80 块走短文路径，超过走长文路径（见第 22 章）。
- **`WINDOW_SIZE = 100`**：窗口内最多 100 块，足够覆盖一屏 + 上下滚动缓冲，又不至于让 ProseMirror 卡。
- **`ORIGIN_HYSTERESIS = 24`**：origin 变化小于 24 块不切窗，避免在窗口边界来回抖动时频繁 `setContent`。
- **`EST_BLOCK_H = 44`**：每块预估高度，用于撑高滚动条。这个值偏大一点没事，偏小会导致滚动条够不到文末。

---

## 19. HTML 切块与窗口工具 utils/doc.ts

这是长文模块的**基础工具层**，不依赖 React，纯函数。长文编辑器和长文预览都复用这套工具。

### 19.1 完整实现

```ts
// src/views/learning-notes/utils/doc.ts
import {
	splitPreviewBlocks,
	stripNoteTitleHtml,
} from '@/components/design/NotePreview/previewHtml';

/** 超过该块数启用长文滚动窗口 */
export const LARGE_MIN_BLOCKS = 80;
/** 编辑器内正文块数 */
export const WINDOW_SIZE = 100;
/** origin 变化至少这么多块才换窗，减少抖动 */
export const ORIGIN_HYSTERESIS = 24;
/** 块高估算（px） */
export const EST_BLOCK_H = 44;

// 标题节点正则：匹配 <div data-type="note-title" ...>...</div>
const TITLE_RE =
	/<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i;

/**
 * 长文文档模型：
 * - blocks: 切好的块级 HTML 数组（不含标题）
 * - origin: 当前窗口起点（blocks 数组的索引）
 * - count: 当前窗口块数（<= WINDOW_SIZE）
 */
export type LargeNoteDoc = {
	blocks: string[];
	origin: number;
	count: number;
};

/** 从 HTML 中提取 title 节点 HTML */
export function extractTitleHtml(html: string): string {
	return html.match(TITLE_RE)?.[0] ?? '';
}

/**
 * 从 HTML 中提取标题纯文本
 * 优先读 data-value 属性（NodeView 写入的值），兜底 textContent
 */
export function extractTitleText(html: string): string {
	const node = extractTitleHtml(html);
	if (!node) return '';
	const fromAttr = node.match(/data-value=["']([^"']*)["']/i)?.[1];
	if (fromAttr != null) return fromAttr.trim();
	return node.replace(/<[^>]+>/g, '').trim();
}

/** 标题文本 → title 节点 HTML（写回时用） */
export function titleToHtml(title: string): string {
	// 转义：避免标题里的 HTML 字符破坏结构
	const safe = title
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return `<div data-type="note-title" data-value="${safe}">${safe}</div>`;
}

/**
 * 判断是否需要走长文路径：
 * - HTML 长度 >= 80_000 字符
 * - 或正文块数 >= 80
 * 两个条件任一满足即判定为长文
 */
export function isLargeNoteHtml(content: unknown): content is string {
	if (typeof content !== 'string' || !content) return false;
	const body = stripNoteTitleHtml(content);
	if (content.length >= 80_000) return true;
	return splitPreviewBlocks(body).length >= LARGE_MIN_BLOCKS;
}

/**
 * 初始化长文文档模型：
 * 1. 抽出标题
 * 2. 剥离标题后的正文按块切开
 * 3. 初始 origin=0，count=min(WINDOW_SIZE, blocks.length)
 * 4. editorHtml 是初始窗口的 HTML（用于挂载 TipTap）
 */
export function createLargeNoteDoc(html: string): {
	doc: LargeNoteDoc;
	title: string;
	editorHtml: string;
} {
	// 不折叠空段：预览/长文编辑窗口与短文编辑态空行一致
	const title = extractTitleText(html);
	const body = stripNoteTitleHtml(html);
	const parts = splitPreviewBlocks(body);
	// 空文档兜底一个空段
	const blocks = parts.length ? parts : ['<p></p>'];
	const count = Math.min(WINDOW_SIZE, blocks.length);
	const doc: LargeNoteDoc = { blocks, origin: 0, count };
	return {
		doc,
		title,
		// 初始窗口 HTML（用于挂载 TipTap）
		editorHtml: blocks.slice(0, count).join('') || '<p></p>',
	};
}

/**
 * 判断编辑器返回的 HTML 是否「实质为空」：
 * - 0 块
 * - 或 <= 3 块且全是 <p></p>
 * 用于 flushWindow 时拒绝空覆盖（避免误把全文清空）
 */
function isEffectivelyEmptyBody(blocks: string[]): boolean {
	if (blocks.length === 0) return true;
	if (blocks.length > 3) return false;
	return blocks.every((b) => /^<p\b[^>]*>\s*<\/p>$/i.test(b));
}

/**
 * 写回当前窗口：
 * 1. 把 editorHtml 按块切开
 * 2. 用切好的块替换 doc.blocks[origin .. origin+count]
 * 3. 更新 count 为新块数
 * @returns 是否写回成功（空覆盖时返回 false）
 */
export function flushWindow(doc: LargeNoteDoc, editorHtml: string): boolean {
	const bodyBlocks = splitPreviewBlocks(stripNoteTitleHtml(editorHtml));
	// 空覆盖守卫：编辑器看起来空了，但全文不该空，拒绝写回
	if (isEffectivelyEmptyBody(bodyBlocks) && doc.count > 3) return false;
	const next = bodyBlocks.length ? bodyBlocks : ['<p></p>'];
	// splice 替换：删除 origin..origin+count，插入 next
	doc.blocks.splice(doc.origin, doc.count, ...next);
	doc.count = next.length;
	return true;
}

/**
 * 取出指定 origin 起的窗口 HTML：
 * - count = min(WINDOW_SIZE, blocks.length - origin)
 * - html = blocks.slice(origin, origin+count).join('')
 */
export function windowBodyHtml(
	doc: LargeNoteDoc,
	origin: number,
): {
	html: string;
	count: number;
} {
	const count = Math.min(WINDOW_SIZE, Math.max(0, doc.blocks.length - origin));
	const html =
		count > 0 ? doc.blocks.slice(origin, origin + count).join('') : '<p></p>';
	return { html, count: count > 0 ? count : 1 };
}

/**
 * 由滚动位置算窗口 origin（居中可视区）：
 * 1. center = scrollTop + viewH / 2（可视中心）
 * 2. centerIdx = center / EST_BLOCK_H（中心对应的块索引）
 * 3. origin = centerIdx - WINDOW_SIZE/2（让窗口居中覆盖可视区）
 * 4. clamp 到 [0, maxOrigin]
 */
export function originForScroll(
	scrollTop: number,
	viewH: number,
	blockCount: number,
	estH: number,
): number {
	const center = scrollTop + viewH / 2;
	const centerIdx = Math.max(
		0,
		Math.min(blockCount - 1, Math.floor(center / estH)),
	);
	const maxOrigin = Math.max(0, blockCount - WINDOW_SIZE);
	return Math.max(
		0,
		Math.min(maxOrigin, centerIdx - Math.floor(WINDOW_SIZE / 2)),
	);
}

/**
 * 拼接全文 HTML（用于保存）：
 * 1. flushWindow 把当前窗口写回
 * 2. 标题 + blocks.join('') 拼成完整 HTML
 */
export function stitchFullHtml(
	doc: LargeNoteDoc,
	title: string,
	editorHtml: string,
): string {
	flushWindow(doc, editorHtml);
	return `${titleToHtml(title)}${doc.blocks.join('')}`;
}

/**
 * 拼接全文纯文本（用于搜索/摘要）：
 * 1. flushWindow 写回
 * 2. 标题 + 正文 HTML
 * 3. <br> → \n，</p> → \n\n，去标签，合并多余空行
 */
export function stitchFullText(
	doc: LargeNoteDoc,
	title: string,
	editorHtml: string,
): string {
	flushWindow(doc, editorHtml);
	const full = `${titleToHtml(title)}${doc.blocks.join('')}`;
	return full
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
```

### 19.2 实现要点

- **`splitPreviewBlocks` 切块策略**：按顶层开闭标签正则切（如 `<p>…</p>`、`<ul>…</ul>`、`<table>…</table>`）。注释里坦白说「嵌套同名标签可能切不准」，但笔记多为扁平结构（段落、标题、列表、表格、图片），切不准的概率低。详见第 23 章。
- **`flushWindow` 的空覆盖守卫**：编辑器返回的 HTML 看起来空了（如 setContent 失败），但全文不该空，此时拒绝写回，避免误删全文。`doc.count > 3` 是为了让初始空文档也能正常写回。
- **`stitchFullHtml` / `stitchFullText` 必须先 `flushWindow`**：当前窗口的编辑结果还在 editor 里没写回 doc，必须先 flush 再拼接，否则保存的是旧内容。
- **`isLargeNoteHtml` 双条件**：80_000 字符或 80 块任一满足。字符数条件是为了覆盖「块不多但每块很大」（如几张 base64 大图）的场景。
- **不依赖 DOMParser**：用正则切而不是 `DOMParser.parseFromString`，因为大 HTML 整树解析会卡主线程。正则虽然不完美，但流式匹配不会卡。

### 19.3 utils/index.ts 导出

```ts
// src/views/learning-notes/utils/index.ts
export {
	createLargeNoteDoc,
	EST_BLOCK_H,
	flushWindow,
	isLargeNoteHtml,
	type LargeNoteDoc,
	ORIGIN_HYSTERESIS,
	originForScroll,
	stitchFullHtml,
	stitchFullText,
	WINDOW_SIZE,
	windowBodyHtml,
} from './doc';
```

---

## 20. 长文本编辑器 LargeNoteEditor

这一章是把第 19 章的工具与第 16 章的 `RichEditor` 编排起来，实现长文连续滚动编辑。

### 20.1 整体设计

```
┌────────────────────────────────────────────────────────┐
│  Toolbar (RichEditor 内置)                              │
├────────────────────────────────────────────────┤
│  NoteTitleField (renderBody 外层渲染，showTitle=false)   │
├────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐    │
│  │  translateY(offsetY)                    │    │ ← 顶部空白（origin * EST_BLOCK_H）
│  ├──────────────────────────────────────────┤    │
│  │  TipTap EditorContent (window blocks)   │    │ ← 实际可编辑窗口
│  ├──────────────────────────────────────────┤    │
│  │  剩余空白 ((blocks.length - origin -    │    │ ← 底部空白
│  │   WINDOW_SIZE) * EST_BLOCK_H)            │    │
│  └──────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

- **`showTitle={false}`**：关闭 RichEditor 内置 TitleNode，标题由 `renderBody` 外层渲染，避免双标题。
- **`renderBody` 包裹 EditorContent**：在 EditorContent 外套绝对定位容器，用 `translateY` 制造「内容很多」的假象。
- **`onBodyScroll` 切窗口**：监听 ScrollArea 滚动，根据 `scrollTop` 算当前应该显示哪个窗口。

### 20.2 完整实现

```tsx
// src/views/learning-notes/components/Editor.tsx
import {
	type Editor,
	NoteTitleField,
	RichEditor,
	type RichEditorLocale,
	type RichEditorProps,
} from '@design/RichEditor';
import {
	type ReactNode,
	type UIEvent,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { cn } from '@/lib/utils';
import {
	createLargeNoteDoc,
	EST_BLOCK_H,
	flushWindow,
	type LargeNoteDoc,
	ORIGIN_HYSTERESIS,
	originForScroll,
	stitchFullHtml,
	stitchFullText,
	WINDOW_SIZE,
	windowBodyHtml,
} from '../utils';

/**
 * 保存 API：供外层（learning-notes/index.tsx）调用，获取全文 HTML / 纯文本 / 标题。
 * 注意：getHTML 必须调 stitchFullHtml 拼接全文，不能只返回当前窗口。
 */
export type LargeNoteSaveApi = {
	getHTML: () => string;
	getText: () => string;
	getTitle: () => string;
};

type Props = {
	defaultContent: string;
	locale: Partial<RichEditorLocale>;
	placeholder?: string;
	toolbarExtra?: RichEditorProps['toolbarExtra'];
	className?: string;
	editorClassName?: string;
	/** 编辑器就绪回调，返回 editor 实例与 save API */
	onReady: (editor: Editor, save: LargeNoteSaveApi) => void;
};

/**
 * 初始化长文文档：
 * 1. createLargeNoteDoc 切块
 * 2. 进编辑要对齐短文「光标在文末」：初始就挂最后一窗
 *    避免挂第一窗后 focus(end) 停在全文中段（视觉上像挂错位置）
 */
function bootLargeNote(defaultContent: string) {
	const created = createLargeNoteDoc(defaultContent);
	const maxOrigin = Math.max(0, created.doc.blocks.length - WINDOW_SIZE);
	if (maxOrigin > 0) {
		const { html, count } = windowBodyHtml(created.doc, maxOrigin);
		created.doc.origin = maxOrigin;
		created.doc.count = count;
		created.editorHtml = html;
	}
	return created;
}

/**
 * 滚动到正文底部 + 焦点文末：
 * - 找到 ScrollArea 的 viewport 元素（data-slot="scroll-area-viewport"）
 * - 设置 scrollTop = scrollHeight
 * - editor.commands.focus('end')
 * 双重保证：DOM 滚动 + ProseMirror 选区
 */
function scrollViewportToEnd(editor: Editor) {
	const vp = editor.view.dom.closest(
		'[data-slot="scroll-area-viewport"]',
	) as HTMLElement | null;
	if (vp) vp.scrollTop = vp.scrollHeight;
	if (!editor.isDestroyed) editor.commands.focus('end');
}

/**
 * 长笔记连续滚动编辑。
 * 标题与短文共用 NoteTitleField，自然文档流紧贴正文
 * （勿用固定 TITLE 槽高，否则会留大缝）。
 */
export function LargeNoteEditor({
	defaultContent,
	locale,
	placeholder,
	toolbarExtra,
	className,
	editorClassName,
	onReady,
}: Props) {
	// === 1. boot：初始化文档模型（只跑一次）===
	// useRef 保证 createLargeNoteDoc 只在挂载时跑一次，避免每次渲染都切块
	const boot = useRef(bootLargeNote(defaultContent));
	const docRef = useRef<LargeNoteDoc>(boot.current.doc);
	const editorRef = useRef<Editor | null>(null);

	// === 2. 标题相关 ref ===
	// 标题高度（用于算滚动时扣除标题区）
	const titleWrapRef = useRef<HTMLDivElement | null>(null);
	const titleHRef = useRef(0);
	const [title, setTitle] = useState(boot.current.title);
	// titleRef：让 saveApi 闭包始终读最新 title，避免 useCallback 依赖 title 重建
	const titleRef = useRef(title);
	titleRef.current = title;

	// === 3. 窗口相关 ref ===
	const originRef = useRef(boot.current.doc.origin);
	// shiftingRef：切窗过程中标志位，避免 onScroll 在切窗时重复触发
	const shiftingRef = useRef(false);
	// scrollRafRef：滚动节流，requestAnimationFrame id
	const scrollRafRef = useRef(0);

	// onReady ref：避免 useCallback 依赖 onReady 重建
	const onReadyRef = useRef(onReady);
	onReadyRef.current = onReady;

	// === 4. 渲染状态：blockCount 和 offsetY 触发重渲染 ===
	const [blockCount, setBlockCount] = useState(boot.current.doc.blocks.length);
	const [offsetY, setOffsetY] = useState(boot.current.doc.origin * EST_BLOCK_H);
	/** 块数不足一窗时勿按 WINDOW_SIZE 垕高（大图笔记常因 base64 进长文路径，否则文末巨空白） */
	const windowed = blockCount > WINDOW_SIZE;
	const bodyH = Math.max(blockCount, 1) * EST_BLOCK_H;

	// === 5. 测量标题高度：标题可能换行（如 50 字标题），用 ResizeObserver 跟踪 ===
	useLayoutEffect(() => {
		const el = titleWrapRef.current;
		if (!el) return;
		const sync = () => {
			titleHRef.current = el.offsetHeight;
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// === 6. saveApi：供外层保存 ===
	// useCallback 空依赖：闭包通过 ref 读最新值，避免每次渲染重建
	const saveApi = useCallback((): LargeNoteSaveApi => {
		return {
			getHTML: () => {
				const e = editorRef.current;
				const html = e && !e.isDestroyed ? e.getHTML() : '';
				// 必须先 flushWindow 再拼接，否则当前窗口编辑结果丢失
				return stitchFullHtml(docRef.current, titleRef.current, html);
			},
			getText: () => {
				const e = editorRef.current;
				const html = e && !e.isDestroyed ? e.getHTML() : '';
				return stitchFullText(docRef.current, titleRef.current, html);
			},
			getTitle: () => titleRef.current.trim(),
		};
	}, []);

	// === 7. 标题 Enter/Tab → 聚焦正文 ===
	const focusBody = useCallback(() => {
		editorRef.current?.commands.focus('start');
	}, []);

	// === 8. applyOrigin：切换窗口核心逻辑 ===
	const applyOrigin = useCallback((editor: Editor, nextOrigin: number) => {
		const doc = docRef.current;
		// 切窗中或 origin 未变：直接返回
		if (shiftingRef.current) return;
		if (nextOrigin === originRef.current) return;

		const maxOrigin = Math.max(0, doc.blocks.length - WINDOW_SIZE);
		// snapEdge：贴边时强制切窗（避免贴边卡在 hysteresis 内）
		const snapEdge =
			(nextOrigin === 0 && originRef.current !== 0) ||
			(nextOrigin === maxOrigin && originRef.current !== maxOrigin);
		// hysteresis：非贴边时变化小于 ORIGIN_HYSTERESIS 不切窗，减少抖动
		if (
			!snapEdge &&
			Math.abs(nextOrigin - originRef.current) < ORIGIN_HYSTERESIS
		) {
			return;
		}

		shiftingRef.current = true;
		try {
			// 1. flushWindow：把当前窗口编辑结果写回 doc.blocks
			flushWindow(doc, editor.getHTML());
			// 2. windowBodyHtml：取下一窗口的 HTML
			const { html, count } = windowBodyHtml(doc, nextOrigin);
			// 3. setContent：切换编辑器内容（emitUpdate: false 避免触发 onUpdate）
			const ok = editor.commands.setContent(html, { emitUpdate: false });
			if (ok === false) return;
			// 4. 更新 doc 模型与 ref
			doc.origin = nextOrigin;
			doc.count = count;
			originRef.current = nextOrigin;
			// 5. 更新渲染状态（触发 translateY 重算）
			setOffsetY(nextOrigin * EST_BLOCK_H);
			setBlockCount(doc.blocks.length);
		} finally {
			// 下一帧解除 shifting 锁，避免 onScroll 在 setContent 过程中重入
			requestAnimationFrame(() => {
				shiftingRef.current = false;
			});
		}
	}, []);

	// === 9. onBodyScroll：滚动监听 ===
	const onBodyScroll = useCallback(
		(e: UIEvent<HTMLDivElement>) => {
			const editor = editorRef.current;
			// 编辑器未就绪 / 切窗中：跳过
			if (!editor || editor.isDestroyed || shiftingRef.current) return;
			const vp = e.currentTarget;
			// 扣除标题高度：标题在文档流里，scrollTop 包含标题区
			const titleH =
				titleHRef.current || titleWrapRef.current?.offsetHeight || 0;
			const top = Math.max(0, vp.scrollTop - titleH);
			const viewH = vp.clientHeight || 600;
			// 节流：当前帧已有 raf 排队，跳过
			if (scrollRafRef.current) return;
			scrollRafRef.current = requestAnimationFrame(() => {
				scrollRafRef.current = 0;
				if (shiftingRef.current) return;
				// 算出下一窗口 origin
				const next = originForScroll(
					top,
					viewH,
					docRef.current.blocks.length,
					EST_BLOCK_H,
				);
				applyOrigin(editor, next);
			});
		},
		[applyOrigin],
	);

	// === 10. renderBody：包裹 EditorContent ===
	const renderBody = useCallback(
		(editorContent: ReactNode) => (
			<div className="relative w-full">
				{/* 文档流标题：与短文 TipTap node-title 同距，mb-2 即空隙 */}
				<div ref={titleWrapRef} className="relative z-1">
					<NoteTitleField
						value={title}
						onChange={setTitle}
						onContinue={focusBody}
					/>
				</div>
				{windowed ? (
					// 长文：绝对定位 + translateY 制造滚动假象
					<div className="relative w-full" style={{ height: bodyH }}>
						<div
							className="absolute top-0 right-0 left-0"
							style={{ transform: `translateY(${offsetY}px)` }}
						>
							{editorContent}
						</div>
					</div>
				) : (
					// 短文：直接文档流（避免不足一窗时撑高出现巨空白）
					<div className="relative w-full">{editorContent}</div>
				)}
			</div>
		),
		[bodyH, focusBody, offsetY, title, windowed],
	);

	return (
		<div className={cn('flex h-full min-h-0 min-w-0 flex-col', className)}>
			<RichEditor
				defaultContent={boot.current.editorHtml}
				// 关闭内置标题：标题由 renderBody 外层渲染
				showTitle={false}
				// 关闭自动聚焦：由 LargeNoteEditor 在 onCreate 后控制
				autofocus={false}
				placeholder={placeholder}
				locale={locale}
				// 长文不显示字数（CharacterCount 在大文档上有 Segmenter 开销）
				showCharCount={false}
				// 长文不显示气泡（选区气泡在切窗时定位会乱）
				showBubbleMenu={false}
				onBodyScroll={onBodyScroll}
				renderBody={renderBody}
				onCreate={(e) => {
					editorRef.current = e;
					docRef.current.origin = originRef.current;
					onReadyRef.current(e, saveApi());
					// 布局完成后再滚到底 + 焦点文末
					// 双 rAF：第一帧 EditorContent 挂载，第二帧 offset 生效
					requestAnimationFrame(() => {
						scrollViewportToEnd(e);
						requestAnimationFrame(() => scrollViewportToEnd(e));
					});
				}}
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
				editorClassName={editorClassName}
				toolbarExtra={toolbarExtra}
			/>
		</div>
	);
}
```

### 20.3 实现要点

- **`boot` 用 `useRef` 而非 `useState`**：`createLargeNoteDoc` 切块是一次性的，不需要响应式更新。`useRef(bootLargeNote(defaultContent))` 保证只跑一次，且不触发重渲染。
- **`windowed` 判断**：块数不足 `WINDOW_SIZE` 时直接走文档流，避免不足一窗时按 `WINDOW_SIZE` 撑高出现「文末巨空白」。
- **`titleHRef` 扣除标题高度**：标题在文档流里，`scrollTop` 包含标题区。算 origin 时要先扣掉标题高度，否则滚动到顶部时算出的 origin 会偏小。
- **`shiftingRef` 锁**：`setContent` 是同步的，但 ProseMirror 的 `scrollIntoView` 等可能在下一帧触发 `onScroll`。锁一帧避免重入。
- **`scrollRafRef` 节流**：`requestAnimationFrame` 每帧只跑一次，避免高频 `onScroll` 触发多次 `applyOrigin`。
- **`snapEdge` 强制切窗**：贴边时（origin=0 或 maxOrigin）强制切窗，避免贴边时落在 `ORIGIN_HYSTERESIS` 内卡住不切。
- **`saveApi` 用 `useCallback` 空依赖 + ref**：闭包通过 `docRef` / `titleRef` / `editorRef` 读最新值，避免每次 title 变化重建 saveApi 导致外层 `onReady` 重新绑定。
- **双 rAF 滚到底**：`onCreate` 时 `EditorContent` 还没挂载完，直接 `focus('end')` 会停在窗口中段。双 rAF 等绝对定位 offset 生效后再滚。

### 20.4 关键 prop 协作

| RichEditor prop | 值 | 原因 |
|---|---|---|
| `showTitle` | `false` | 标题由 `renderBody` 外层 `NoteTitleField` 渲染 |
| `autofocus` | `false` | 由 `LargeNoteEditor.onCreate` 双 rAF 控制 |
| `showCharCount` | `false` | CharacterCount 在大文档上有 Segmenter 开销 |
| `showBubbleMenu` | `false` | 切窗时气泡定位会乱 |
| `onBodyScroll` | `onBodyScroll` | 监听滚动切窗 |
| `renderBody` | `renderBody` | 包裹 EditorContent，加标题 + 绝对定位 |
| `defaultContent` | `boot.editorHtml` | 初始窗口 HTML（非全文）|

---

## 21. 长文本预览 WindowedPreviewBody

这一章实现长文只读预览。与编辑器不同，预览不需要 TipTap，直接 `dangerouslySetInnerHTML` 挂静态 HTML，但仍需窗口化避免大 DOM 卡顿。

### 21.1 整体设计

```
┌────────────────────────────────────────────────────────┐
│  NotePreview header (标题 + meta)                       │
├────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐           │
│  │  translateY(offsetY)                    │           │ ← 顶部空白
│  ├──────────────────────────────────────────┤           │
│  │  静态 HTML (window blocks)              │           │ ← 当前窗口
│  │  dangerouslySetInnerHTML                │           │
│  ├──────────────────────────────────────────┤           │
│  │  剩余空白                                │           │ ← 底部空白
│  └──────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────┘
```

与编辑器的区别：

- **无 TipTap**：直接 `dangerouslySetInnerHTML`，不挂 ProseMirror。
- **无 flushWindow**：预览只读，不修改 doc。
- **`useMemo` 切窗口**：origin 变化时 `windowBodyHtml` + `decoratePreviewHtml` 重新计算窗口 HTML。

### 21.2 完整实现

```tsx
// src/views/learning-notes/components/PreviewBody.tsx
import {
	type UIEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	decoratePreviewHtml,
	preserveEmptyParagraphs,
} from '@/components/design/NotePreview/previewHtml';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
	createLargeNoteDoc,
	EST_BLOCK_H,
	type LargeNoteDoc,
	ORIGIN_HYSTERESIS,
	originForScroll,
	WINDOW_SIZE,
	windowBodyHtml,
} from '../utils';

type Props = {
	html: string;
	className?: string;
};

/**
 * 长文只读预览：与 LargeNoteEditor 同一套滚动窗口，
 * 避免全文 DOM 拖垮左侧列表滚动。
 *
 * 与编辑器区别：
 * - 无 TipTap，直接 dangerouslySetInnerHTML
 * - 无 flushWindow（只读不改）
 * - origin 变化时 useMemo 重算窗口 HTML
 */
export function WindowedPreviewBody({ html, className }: Props) {
	// === 1. boot：初始化文档模型 ===
	// useMemo 依赖 html：html 变化时重建（切换笔记）
	const boot = useMemo(() => createLargeNoteDoc(html), [html]);
	const docRef = useRef<LargeNoteDoc>(boot.doc);
	const originRef = useRef(0);
	const shiftingRef = useRef(false);
	const scrollRafRef = useRef(0);

	// === 2. 渲染状态 ===
	const [origin, setOrigin] = useState(0);
	const [offsetY, setOffsetY] = useState(0);
	const blockCount = boot.doc.blocks.length;
	const bodyH = Math.max(blockCount, 1) * EST_BLOCK_H;
	const windowed = blockCount > WINDOW_SIZE;

	// 保持 docRef 指向最新 boot.doc（html 变化时 boot 重建）
	docRef.current = boot.doc;

	// === 3. windowHtml：当前窗口的静态 HTML ===
	// useMemo 依赖 boot.doc 和 origin：origin 变化时重算
	const windowHtml = useMemo(() => {
		const { html: slice } = windowBodyHtml(boot.doc, origin);
		// decoratePreviewHtml：图片加 loading=lazy / decoding=async
		// preserveEmptyParagraphs：空段补 <br>，避免静态 HTML 高度塌掉
		return decoratePreviewHtml(preserveEmptyParagraphs(slice));
	}, [boot.doc, origin]);

	// === 4. applyOrigin：切换窗口 ===
	const applyOrigin = useCallback((nextOrigin: number) => {
		const doc = docRef.current;
		if (shiftingRef.current) return;
		if (nextOrigin === originRef.current) return;

		const maxOrigin = Math.max(0, doc.blocks.length - WINDOW_SIZE);
		// snapEdge：贴边时强制切窗
		const snapEdge =
			(nextOrigin === 0 && originRef.current !== 0) ||
			(nextOrigin === maxOrigin && originRef.current !== maxOrigin);
		if (
			!snapEdge &&
			Math.abs(nextOrigin - originRef.current) < ORIGIN_HYSTERESIS
		) {
			return;
		}

		shiftingRef.current = true;
		originRef.current = nextOrigin;
		doc.origin = nextOrigin;
		doc.count = Math.min(
			WINDOW_SIZE,
			Math.max(0, doc.blocks.length - nextOrigin),
		);
		// 触发 windowHtml useMemo 重算
		setOrigin(nextOrigin);
		setOffsetY(nextOrigin * EST_BLOCK_H);
		// 下一帧解锁
		requestAnimationFrame(() => {
			shiftingRef.current = false;
		});
	}, []);

	// === 5. onScroll：滚动监听 ===
	const onScroll = useCallback(
		(e: UIEvent<HTMLDivElement>) => {
			if (shiftingRef.current) return;
			const vp = e.currentTarget;
			// 预览没有标题区，直接用 scrollTop
			const top = Math.max(0, vp.scrollTop);
			const viewH = vp.clientHeight || 600;
			if (scrollRafRef.current) return;
			scrollRafRef.current = requestAnimationFrame(() => {
				scrollRafRef.current = 0;
				if (shiftingRef.current) return;
				applyOrigin(
					originForScroll(
						top,
						viewH,
						docRef.current.blocks.length,
						EST_BLOCK_H,
					),
				);
			});
		},
		[applyOrigin],
	);

	// 卸载时取消 raf，避免内存泄漏
	useEffect(
		() => () => {
			if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
		},
		[],
	);

	return (
		<ScrollArea
			className={cn(
				'rich-editor-body note-preview-static text-textcolor min-h-0 flex-1',
				className,
			)}
			// 不足一窗时不挂 onScroll，避免无意义切窗
			onScroll={windowed ? onScroll : undefined}
		>
			{windowed ? (
				// 长文：绝对定位 + translateY 制造滚动假象
				<div className="relative w-full" style={{ height: bodyH }}>
					<div
						className="tiptap note-preview-tiptap ProseMirror absolute top-0 right-0 left-0"
						style={{ transform: `translateY(${offsetY}px)` }}
						dangerouslySetInnerHTML={{ __html: windowHtml }}
					/>
				</div>
			) : (
				// 短文：直接文档流
				<div
					className="tiptap note-preview-tiptap ProseMirror relative w-full"
					dangerouslySetInnerHTML={{ __html: windowHtml }}
				/>
			)}
		</ScrollArea>
	);
}
```

### 21.3 实现要点

- **`useMemo(() => createLargeNoteDoc(html), [html])`**：html 变化时（切换笔记）重建文档模型。`useMemo` 比 `useRef` 更合适，因为依赖明确。
- **`docRef.current = boot.doc` 同步**：每次渲染把 `boot.doc` 同步到 `docRef`，让 `applyOrigin` 闭包读到最新 doc。这一步必须在渲染阶段完成，避免 `onScroll` 在 commit 阶段读到旧 doc。
- **`windowHtml` 用 `useMemo`**：origin 变化时重算窗口 HTML。`decoratePreviewHtml` 给图片加 `loading=lazy` / `decoding=async`，避免大图同步解码卡顿。
- **`preserveEmptyParagraphs`**：空段 `<p></p>` 在静态 HTML 里高度会塌掉（ProseMirror 有 `ContentEditable` 会自动撑高），补 `<br>` 让高度与编辑态一致。
- **不调 `flushWindow`**：预览只读，不改 doc。切窗时直接 `setOrigin` 触发 `windowHtml` 重算。
- **`onScroll={windowed ? onScroll : undefined}`**：不足一窗时不挂监听，避免无意义切窗。

### 21.4 与编辑器对比

| 维度 | LargeNoteEditor | WindowedPreviewBody |
|---|---|---|
| 渲染 | TipTap `EditorContent` | `dangerouslySetInnerHTML` |
| 切窗 | `editor.commands.setContent` | `setOrigin` + `useMemo` 重算 |
| flushWindow | 必须（写回编辑结果） | 不需要（只读） |
| 标题 | `renderBody` 外层 `NoteTitleField` | `NotePreview` header |
| 滚动扣除标题 | 是（`titleHRef`） | 否（标题在 header 外） |
| 字数/气泡 | 关闭 | 不适用 |
| 卸载清理 | TipTap 自带 | 手动 `cancelAnimationFrame` |

---

## 22. 短文/长文自动切换（learning-notes/index.tsx）

这一章讲解业务层如何根据内容自动选择短文或长文路径。

### 22.1 切换逻辑

```tsx
// src/views/learning-notes/index.tsx（节选）
import Loading from '@design/Loading';
import { NotePreview } from '@design/NotePreview';
import {
	Btn,
	type Editor,
	RichEditor,
} from '@design/RichEditor';
import { LargeNoteEditor, type LargeNoteSaveApi } from './components/Editor';
import { NotesListPanel } from './components/NotesListPanel';
import { WindowedPreviewBody } from './components/PreviewBody';
import { isLargeNoteHtml } from './utils';

// ... 中间略 ...

const editorLocale = useMemo(() => richEditorLocaleOf(locale), [locale]);
const editorKey = `${store.editorSeed}:${locale}`;
const editorReady = readyKey === editorKey;
// 判断是否走长文路径
const useLarge = isLargeNoteHtml(store.editorInitial);

// 先画 Loading，下一帧再挂 TipTap，避免长文解析时连遮罩都刷不出来
useEffect(() => {
	if (store.preview) {
		setMountEditor(false);
		return;
	}
	setMountEditor(false);
	pagedSaveRef.current = null;
	const id = requestAnimationFrame(() => setMountEditor(true));
	return () => cancelAnimationFrame(id);
}, [editorKey, store.preview]);

return (
	<div className={cn('bg-theme/5 text-textcolor flex h-full min-h-0 min-w-0 flex-col text-sm rounded-md')}>
		{/* 确认弹窗、列表、编辑器/预览 */}
		<ResizablePanelGroup id="learning-notes-split" orientation="horizontal" className="h-full min-h-0 min-w-0 flex-1">
			{/* 左侧列表 */}
			{store.listOpen ? (
				<>
					<ResizablePanel id="learning-notes-list" defaultSize={35} minSize={0} className="min-h-0 min-w-0">
						<NotesListPanel locale={locale} />
					</ResizablePanel>
					<ResizableHandle withHandle className="w-0" />
				</>
			) : null}

			{/* 右侧编辑/预览 */}
			<ResizablePanel id="learning-notes-editor" defaultSize={store.listOpen ? 65 : 100} minSize={50} className="min-h-0 min-w-0">
				<div className="border-theme/10 relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
					{!store.preview ? (
						<>
							{mountEditor ? (
								// 长文路径
								useLarge && typeof store.editorInitial === 'string' ? (
									<LargeNoteEditor
										key={editorKey}
										defaultContent={store.editorInitial}
										placeholder={t('learningNotes.placeholder')}
										locale={editorLocale}
										onReady={(e, save) => {
											editorRef.current = e;
											pagedSaveRef.current = save;
											setReadyKey(editorKey);
										}}
										className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
										editorClassName="min-h-[6rem]"
										toolbarExtra={toolbarExtra}
									/>
								) : (
									// 短文路径
									<RichEditor
										key={editorKey}
										defaultContent={store.editorInitial}
										autofocus="end"
										placeholder={t('learningNotes.placeholder')}
										locale={editorLocale}
										showCharCount={false}
										onCreate={(e) => {
											editorRef.current = e;
											pagedSaveRef.current = null;
											setReadyKey(editorKey);
										}}
										className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
										editorClassName="min-h-[6rem]"
										toolbarExtra={toolbarExtra}
									/>
								)
							) : null}
							{!editorReady ? (
								<div className="bg-background/60 absolute inset-0 z-10 flex items-center justify-center">
									<Loading />
								</div>
							) : null}
						</>
					) : (
						// 预览路径
						<div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden contain-[layout_paint]">
							{isLargeNoteHtml(store.preview.html) ? (
								// 长文预览：用 WindowedPreviewBody 作为 children
								<NotePreview
									title={store.preview.title}
									headerExtra={previewHeaderExtra}
									loading={store.loadingDetail}
								>
									<WindowedPreviewBody
										key={store.preview.id}
										html={store.preview.html}
									/>
								</NotePreview>
							) : (
								// 短文预览：直接传 html
								<NotePreview
									title={store.preview.title}
									html={store.preview.html}
									headerExtra={previewHeaderExtra}
									loading={store.loadingDetail}
								/>
							)}
							{store.loadingDetail ? (
								<div className="bg-background/60 absolute inset-0 z-10 flex items-center justify-center">
									<Loading />
								</div>
							) : null}
						</div>
					)}
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	</div>
);
```

### 22.2 实现要点

- **`useLarge = isLargeNoteHtml(store.editorInitial)`**：每次切换笔记都重新判断，短文/长文自动切换。
- **`mountEditor` 双 rAF**：先画 Loading，下一帧再挂 TipTap。长文 `createLargeNoteDoc` 切块也要时间，先画 Loading 避免遮罩都刷不出来。
- **`pagedSaveRef`**：长文路径用 `LargeNoteSaveApi`（拼全文），短文路径设为 `null`（直接 `editor.getHTML()`）。保存时判断 `pagedSaveRef.current` 是否存在决定走哪条路径。
- **`contain-[layout_paint]`**：预览容器加 CSS `contain`，避免预览大 DOM 的布局/绘制连锁拖垮左侧列表滚动。
- **`key={store.preview.id}` / `key={editorKey}`**：切换笔记时强制重建，避免复用旧状态。

### 22.3 切换决策矩阵

| 内容特征 | 编辑路径 | 预览路径 |
|---|---|---|
| 短文（<80 块 且 <80KB） | `RichEditor` | `NotePreview`（直接 html） |
| 长文（>=80 块 或 >=80KB） | `LargeNoteEditor` | `NotePreview` + `WindowedPreviewBody`（children） |

---

## 23. 预览 HTML 处理工具 NotePreview/previewHtml.ts

这是第 19 章 `utils/doc.ts` 依赖的底层 HTML 工具，也是 `NotePreview` 组件的预处理工具。

### 23.1 完整实现

```ts
// src/components/design/NotePreview/previewHtml.ts

/**
 * 去掉文档内嵌的 title 节点。
 * ponytail: 大文档（含 base64 图）用正则，避免 DOMParser 整树解析卡死主线程。
 * title 的 renderHTML 是单层 div，无嵌套同名闭合问题。
 */
export function stripNoteTitleHtml(html: string): string {
	if (!html) return '';
	return html.replace(
		/<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i,
		'',
	);
}

/**
 * 空段落补 `<br>`，与 TipTap 编辑态占位一致
 * （纯 `<p></p>` 在静态 HTML 高度会塌掉，因为 ProseMirror 的 ContentEditable 会自动撑高）。
 */
export function preserveEmptyParagraphs(html: string): string {
	if (!html) return '';
	return html.replace(
		/<p(\b[^>]*)>(?:\s|&nbsp;|\u00a0)*<\/p>/gi,
		'<p$1><br></p>',
	);
}

/**
 * 预览图异步解码：
 * - loading="lazy"：进入视口才加载
 * - decoding="async"：异步解码，不阻塞主线程
 * 已有对应属性则不改
 */
export function decoratePreviewHtml(html: string): string {
	if (!html) return '';
	return html.replace(/<img\b([^>]*)>/gi, (_full, attrs: string) => {
		let next = attrs;
		if (!/\bloading\s*=/i.test(next)) next += ' loading="lazy"';
		if (!/\bdecoding\s*=/i.test(next)) next += ' decoding="async"';
		return `<img${next}>`;
	});
}

/**
 * 按顶层开闭标签切开（笔记多为扁平 p/h/ul/table）。
 * ponytail: 嵌套同名标签可能切不准；失败时调用方回退整段挂载。
 *
 * 正则解释：
 * - <([a-z][a-z0-9]*)  捕获标签名
 * - \b[^>]*             标签属性
 * - (?:\/>|>[\s\S]*?<\/\1>)  自闭合 或 开闭标签（[\s\S]*? 非贪婪跨行）
 *
 * 例：
 *   <p>段1</p><h2>标题</h2><ul><li>项</li></ul>
 *   → ['<p>段1</p>', '<h2>标题</h2>', '<ul><li>项</li></ul>']
 */
export function splitPreviewBlocks(html: string): string[] {
	if (!html) return [];
	const blocks: string[] = [];
	const re = /<([a-z][a-z0-9]*)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/gi;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		// 标签之间的空白也当作块（避免丢失）
		if (m.index > last) {
			const gap = html.slice(last, m.index).trim();
			if (gap) blocks.push(gap);
		}
		blocks.push(m[0]);
		last = m.index + m[0].length;
	}
	// 尾部剩余
	if (last < html.length) {
		const tail = html.slice(last).trim();
		if (tail) blocks.push(tail);
	}
	return blocks.length ? blocks : [html];
}

/**
 * 预览正文预处理流水线：
 * 1. stripNoteTitleHtml：去标题
 * 2. preserveEmptyParagraphs：空段补 <br>
 * 3. decoratePreviewHtml：图片懒加载
 */
export function preparePreviewBody(html: string): string {
	return decoratePreviewHtml(preserveEmptyParagraphs(stripNoteTitleHtml(html)));
}
```

### 23.2 实现要点

- **正则而非 DOMParser**：大文档（含 base64 图）用 `DOMParser.parseFromString` 整树解析会卡主线程。正则流式匹配不卡。代价是嵌套同名标签切不准，但笔记多为扁平结构。
- **`[\s\S]*?` 非贪婪**：跨行匹配开闭标签内容，非贪婪避免一个 `<ul>` 吃掉后续所有 `<ul>`。
- **`preserveEmptyParagraphs` 必要性**：ProseMirror 的 `ContentEditable` 会自动给空 `<p></p>` 撑高，但静态 HTML 里 `<p></p>` 高度为 0。补 `<br>` 让预览与编辑态高度一致。
- **`decoratePreviewHtml` 给图片加懒加载**：长文预览时只渲染当前窗口的图片，但窗口切换时其他图片也会进入 DOM。`loading=lazy` 让浏览器只解码进入视口的图片。

---

## 24. 只读预览组件 NotePreview

这是短文预览路径用的组件，长文路径把它当壳，children 传 `WindowedPreviewBody`。

### 24.1 完整实现

```tsx
// src/components/design/NotePreview/index.tsx
import { type ReactNode, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';
import '../RichEditor/styles.css';
import { preparePreviewBody } from './previewHtml';
import './styles.css';
import { Component } from 'lucide-react';

export type NotePreviewProps = {
	/** 顶栏标题（替代编辑器 toolbar） */
	title: string;
	/** TipTap HTML 或 JSON 内容 */
	html?: string;
	/** 顶栏标题旁/下方的次要信息（时间、标签等） */
	meta?: ReactNode;
	/** 顶栏右侧操作（返回编辑、列表开关等） */
	headerExtra?: ReactNode;
	/** 自定义正文；传入时忽略 html */
	children?: ReactNode;
	footer?: ReactNode;
	className?: string;
	bodyClassName?: string;
	emptyText?: string;
	loading?: boolean;
};

export {
	decoratePreviewHtml,
	preparePreviewBody,
	preserveEmptyParagraphs,
	splitPreviewBlocks,
	stripNoteTitleHtml,
} from './previewHtml';

/**
 * 笔记只读预览：与编辑态同一套 ScrollArea + RichEditor 正文样式
 * （静态 HTML，不挂 TipTap）。
 *
 * 用法：
 * - 短文：<NotePreview title={t} html={h} />
 * - 长文：<NotePreview title={t}><WindowedPreviewBody html={h} /></NotePreview>
 */
export function NotePreview({
	title,
	html,
	meta,
	headerExtra,
	children,
	footer,
	className,
	bodyClassName,
	emptyText,
	loading,
}: NotePreviewProps) {
	const { t } = useI18n();
	const empty = emptyText ?? t('common.emptyContent');
	// 预处理正文 HTML（去标题、补空段、图片懒加载）
	const bodyHtml = useMemo(
		() => (html ? preparePreviewBody(html) : ''),
		[html],
	);

	return (
		<div
			className={cn(
				// contain：预览大 DOM 不参与左侧列表滚动时的布局/绘制连锁
				'note-preview flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r-md contain-[layout_paint_style]',
				className,
			)}
		>
			{/* 顶栏：标题 + meta + 操作 */}
			<header className="note-preview-header h-10 border-theme/10 flex shrink-0 items-center gap-3 border-b pl-3 pr-1.5 py-2.5">
				<div className="min-w-0 flex-1">
					<h1 className="text-textcolor truncate text-base font-semibold leading-snug">
						{title.trim() || t('common.untitledNote')}
					</h1>
					{meta ? (
						<div className="text-textcolor/45 mt-0.5 truncate text-xs">
							{meta}
						</div>
					) : null}
				</div>
				{headerExtra ? (
					<div className="flex shrink-0 items-center gap-0.5">
						{headerExtra}
					</div>
				) : null}
			</header>

			{/* 正文区域 */}
			{children != null ? (
				// 长文：children 是 WindowedPreviewBody，自己管理滚动
				children
			) : bodyHtml ? (
				// 短文：直接挂静态 HTML
				<ScrollArea
					className={cn(
						'rich-editor-body note-preview-static text-textcolor min-h-0 flex-1',
						bodyClassName,
					)}
				>
					<div
						className="tiptap note-preview-tiptap ProseMirror"
						// TipTap 导出 HTML；预览只读
						dangerouslySetInnerHTML={{ __html: bodyHtml }}
					/>
				</ScrollArea>
			) : loading ? null : (
				// 空状态
				<div className="flex items-center justify-center flex-col gap-5 h-full box-border min-w-0 max-w-full w-full p-3 rounded-md">
					<Component className="w-16 h-16 text-textcolor/70 animate-bounce" />
					<div className="text-sm text-textcolor/80">{empty}</div>
				</div>
			)}

			{footer ? <div className="shrink-0">{footer}</div> : null}
		</div>
	);
}

export default NotePreview;
```

### 24.2 NotePreview 样式

```css
/* src/components/design/NotePreview/styles.css */
.note-preview-editor {
	background: transparent;
}

/* 预览正文 padding：比编辑态略小，去掉顶部 padding 贴近 header */
.note-preview-editor .rich-editor-body,
.note-preview-static.rich-editor-body {
	padding: 0.75rem;
	padding-top: 0.28rem;
	text-align: justify;
}

/* 预览光标与选择：可选中复制，但不是编辑态 */
.note-preview-tiptap {
	cursor: default;
	-webkit-user-select: text;
	user-select: text;
}

/* 预览模式隐藏标题节点（标题在 header 里） */
.note-preview-editor .rich-editor-note-title,
.note-preview-editor [data-node-view-wrapper].rich-editor-note-title {
	display: none !important;
}

/* 首块去顶部 margin：贴紧 header */
.note-preview-editor .ProseMirror > *:first-child,
.note-preview-static .ProseMirror > *:first-child,
.note-preview-static.rich-editor-body > .tiptap > *:first-child {
	margin-top: 0;
}

/* 静态预览：todo 勾选仅展示，避免误点 */
.note-preview-static ul[data-type="taskList"] label {
	pointer-events: none;
}

/* 空段兜底高度（与编辑态 line-height: 1.9 对齐） */
.note-preview-static .tiptap p:empty {
	min-height: 1.9em;
}

/* 分帧挂载中：略降透明度提示仍在填充 */
.note-preview-filling {
	opacity: 0.98;
}
```

### 24.3 实现要点

- **`contain-[layout_paint_style]`**：CSS `contain` 隔离预览大 DOM 的布局/绘制，避免与左侧列表滚动连锁。这是长文预览不卡顿的关键之一。
- **`note-preview-static` class**：区分静态预览与编辑态，关闭 `pointer-events`（任务列表勾选不可点）、加 `cursor: default`。
- **`children != null` 优先**：长文路径传 `children`（`WindowedPreviewBody`），短文路径传 `html`。这样长文路径走自己的滚动逻辑，不复用 `NotePreview` 的 `ScrollArea`。
- **复用 `RichEditor/styles.css`**：预览正文样式（`.tiptap p`、`h1-h5`、`blockquote`、`pre` 等）与编辑态完全一致，所以直接 import RichEditor 的样式。

---

## 25. 长文本模块验收清单

### 25.1 短文/长文自动切换

- [ ] 短文（<80 块 且 <80KB）走 `RichEditor`，不切窗。
- [ ] 长文（>=80 块 或 >=80KB）走 `LargeNoteEditor`，切窗。
- [ ] 切换笔记时短文/长文路径自动切换。
- [ ] 长文编辑器打开时 Loading 先出现，下一帧才挂 TipTap。
- [ ] 预览路径同样根据长短文切换 `NotePreview` / `NotePreview + WindowedPreviewBody`。

### 25.2 长文编辑器

- [ ] 打开长文时初始挂最后一窗，光标在文末。
- [ ] 标题输入正常，Enter/Tab 跳到正文。
- [ ] 标题换行（如 50 字标题）时滚动算 origin 仍正确（扣除标题高度）。
- [ ] 滚动到顶部时切到第一窗，滚动到底部时切到最后一窗。
- [ ] 窗口边界来回滚动时不抖动（`ORIGIN_HYSTERESIS` 生效）。
- [ ] 贴边时强制切窗（`snapEdge` 生效），不会卡在 hysteresis 内。
- [ ] 切窗过程中不触发重复切窗（`shiftingRef` 生效）。
- [ ] 切窗后编辑器内容正确，光标不丢失。
- [ ] 切窗后 `onUpdate` 不触发（`emitUpdate: false` 生效）。
- [ ] 保存时 `getHTML()` 返回全文（标题 + 全部块），不是当前窗口片段。
- [ ] 保存时 `getText()` 返回全文纯文本，段落间有 `\n\n`。
- [ ] 保存时当前窗口编辑结果已写回（`flushWindow` 生效）。
- [ ] 块数不足 `WINDOW_SIZE` 时不切窗，直接文档流（无巨空白）。

### 25.3 长文预览

- [ ] 长文预览打开时不卡顿（先 Loading，再挂载）。
- [ ] 滚动时切窗流畅，不闪屏。
- [ ] 图片懒加载（`loading=lazy`），进入视口才加载。
- [ ] 空段落高度与编辑态一致（`preserveEmptyParagraphs` 生效）。
- [ ] 任务列表勾选框不可点（`pointer-events: none`）。
- [ ] 预览正文样式与编辑态一致（复用 `RichEditor/styles.css`）。
- [ ] 左侧列表滚动与预览滚动互不卡顿（`contain` 生效）。
- [ ] 块数不足 `WINDOW_SIZE` 时直接挂全文，不切窗。

### 25.4 HTML 工具

- [ ] `stripNoteTitleHtml` 正确剥离标题节点。
- [ ] `extractTitleText` 优先读 `data-value`，兜底 textContent。
- [ ] `titleToHtml` 正确转义 HTML 特殊字符。
- [ ] `splitPreviewBlocks` 切块结果与原 HTML 拼接还原一致。
- [ ] `isLargeNoteHtml` 双条件（80_000 字符或 80 块）任一满足即判定长文。
- [ ] `createLargeNoteDoc` 空文档兜底 `<p></p>`。
- [ ] `flushWindow` 空覆盖守卫生效（编辑器空但全文不空时拒绝写回）。
- [ ] `stitchFullHtml` / `stitchFullText` 先 `flushWindow` 再拼接。

### 25.5 性能验收

- [ ] 10 万字笔记打开编辑器 <2s 可交互。
- [ ] 10 万字笔记滚动编辑不卡顿（FPS >30）。
- [ ] 10 万字笔记预览打开 <1s 可见。
- [ ] 10 万字笔记预览滚动不卡顿。
- [ ] 长文编辑/预览时左侧列表滚动流畅（FPS >50）。
- [ ] 长文含 50 张 base64 图片时打开/滚动不卡顿。

---

## 附录 B：长文模块依赖图

```
                    ┌─────────────────────────────┐
                    │   NotePreview/previewHtml   │ ← HTML 工具底层
                    │   (splitPreviewBlocks 等)    │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   utils/doc.ts             │ ← 长文文档模型
                    │   (createLargeNoteDoc /    │
                    │    flushWindow /           │
                    │    windowBodyHtml /         │
                    │    stitchFullHtml)          │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
    ┌─────────▼─────────┐  ┌──────▼───────┐    ┌────────▼────────┐
    │  Editor.tsx       │  │  PreviewBody │    │  NotePreview    │
    │  (LargeNoteEditor)│  │  .tsx        │    │  (短文预览壳)    │
    │  用 RichEditor +  │  │  (Windowed   │    │  children 模式  │
    │  renderBody 切窗   │  │  PreviewBody)│    │  接 WindowedBody│
    └─────────┬─────────┘  └──────────────┘    └─────────────────┘
              │
    ┌─────────▼─────────┐
    │  RichEditor       │ ← 复用第 1-16 章
    │  (showTitle=false │
    │   renderBody)     │
    └───────────────────┘
```

---

## 结语（第二部分）

第二部分覆盖了长文编辑与长文预览的完整实现：

1. **HTML 切块工具**（第 19 章）：`splitPreviewBlocks` 正则切块 + `LargeNoteDoc` 文档模型 + `flushWindow` / `stitchFullHtml` 写回拼接。
2. **长文编辑器**（第 20 章）：`renderBody` 包裹 EditorContent + `onBodyScroll` 监听 + `applyOrigin` 切窗 + 双 rAF 滚到底。
3. **长文预览**（第 21 章）：`dangerouslySetInnerHTML` 静态 HTML + `useMemo` 切窗 + 图片懒加载。
4. **自动切换**（第 22 章）：`isLargeNoteHtml` 双条件判断 + `mountEditor` 双 rAF。
5. **HTML 预处理**（第 23 章）：`stripNoteTitleHtml` + `preserveEmptyParagraphs` + `decoratePreviewHtml`。
6. **预览组件**（第 24 章）：`NotePreview` 短文壳 + children 模式接长文。

核心思路：**窗口化**。把全文切成块数组，编辑器/预览只挂当前窗口的 ~100 块，用 `translateY` 制造滚动假象。滚动时 `flushWindow` 写回当前窗口、`windowBodyHtml` 取下一窗口、`setContent` 切换。保存时 `stitchFullHtml` 拼接全文。

关键技巧：
- **正则切块而非 DOMParser**：避免大文档整树解析卡主线程。
- **`shiftingRef` 锁 + `scrollRafRef` 节流**：避免切窗过程重入。
- **`ORIGIN_HYSTERESIS` + `snapEdge`**：减少抖动，贴边强制切窗。
- **`contain-[layout_paint]`**：CSS 隔离避免与左侧列表滚动连锁。
- **`emitUpdate: false`**：切窗时不触发 `onUpdate`，避免循环。
- **双 rAF**：等 EditorContent 挂载与 offset 生效后再滚到底。

按章节实现，长文模块可与短文模块共用第 1-16 章的 RichEditor，无需重复造轮子。
