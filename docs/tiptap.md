# Tiptap v3 详细使用指南

> 面向 React 项目，从安装初始化到自定义扩展的完整参考手册（2026-07）

---

## 目录

1. [安装与初始化](#1-安装与初始化)
2. [核心概念](#2-核心概念)
3. [StarterKit](#3-starterkit)
4. [常用扩展](#4-常用扩展)
5. [工具栏：BubbleMenu 与 FloatingMenu](#5-工具栏bubblemenu-与-floatingmenu)
6. [自定义扩展](#6-自定义扩展)
7. [内容序列化与持久化](#7-内容序列化与持久化)
8. [事件系统](#8-事件系统)
9. [命令系统](#9-命令系统)
10. [样式与主题定制](#10-样式与主题定制)
11. [v3 新特性](#11-v3-新特性)

---

## 1. 安装与初始化

### 1.1 npm 安装

**核心三件套（必须）：**

```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit
```

**附加常用扩展（按需安装）：**

```bash
npm install @tiptap/extension-link \
  @tiptap/extension-image \
  @tiptap/extension-table \
  @tiptap/extension-code-block-lowlight \
  @tiptap/extension-placeholder \
  @tiptap/extension-highlight \
  lowlight
```

### 1.2 最小化 React 组件

```tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

function TiptapEditor() {
	const editor = useEditor({
		extensions: [StarterKit], // 扩展列表
		content: "<p>Hello World!</p>", // 初始内容（支持 HTML 或 JSON）
		editable: true, // 是否可编辑
		autofocus: "end", // 自动聚焦位置：start | end | all
		immediatelyRender: false, // SSR 环境必须设为 false
	});

	return <EditorContent editor={editor} />;
}

export default TiptapEditor;
```

> **SSR 注意事项：** Next.js App Router 等服务端渲染环境下，`useEditor` 必须设置 `immediatelyRender: false`，否则会导致 hydration 错误。

### 1.3 跨组件共享 Editor 实例

```tsx
import { useEditor, EditorContent, EditorContext } from "@tiptap/react";
import { useMemo } from "react";

function EditorProvider({ children }) {
	const editor = useEditor({
		extensions: [StarterKit],
		content: "<p>Hello!</p>",
	});

	const value = useMemo(() => ({ editor }), [editor]);

	return (
		<EditorContext.Provider value={value}>{children}</EditorContext.Provider>
	);
}

// 子组件中使用
function Toolbar() {
	const { editor } = useContext(EditorContext);
	return (
		<button onClick={() => editor.chain().focus().toggleBold().run()}>
			Bold
		</button>
	);
}
```

### 1.4 useEditorState（v3 响应式状态 Hook）

```tsx
import { useEditorState } from "@tiptap/react";

function Toolbar({ editor }) {
	const state = useEditorState({
		editor,
		selector: ({ editor }) => ({
			isBold: editor.isActive("bold"),
			isItalic: editor.isActive("italic"),
			isHeading: editor.isActive("heading", { level: 1 }),
		}),
	});

	return (
		<button
			className={state.isBold ? "active" : ""}
			onClick={() => editor.chain().focus().toggleBold().run()}
		>
			B
		</button>
	);
}
```

> **性能优势：** `useEditorState` 只在 selector 返回值变化时重新渲染组件，比监听 `onUpdate` 更高效。这是 v3 推荐的状态订阅方式。

---

## 2. 核心概念

Tiptap 基于 ProseMirror 的严格 Schema 架构，所有内容都必须符合预定义的结构规则。

| 概念          | 说明                               | 示例                                        |
| ------------- | ---------------------------------- | ------------------------------------------- |
| **Extension** | 注册新功能，不修改文档 schema      | Placeholder, Dropcursor, History            |
| **Node**      | 文档树中的内容类型，可包含子节点   | Paragraph, Heading, Image, Table, CodeBlock |
| **Mark**      | 可附加到节点上的内联格式，可叠加   | Bold, Italic, Link, Highlight, Underline    |
| **Command**   | 改变编辑器状态的命令，返回 boolean | `toggleBold()`, `insertContent()`           |
| **Plugin**    | ProseMirror 原生插件，处理底级行为 | 输入规则、粘贴处理、拖拽                    |

> **Node vs Mark 的关键区别：** Node 是内容单元（块级或内联），定义文档结构；Mark 是附加在 Text Node 上的格式标记（粗体、斜体、链接），可以叠加（一段文本可以同时加粗和斜体）。

---

## 3. StarterKit

StarterKit 是最常用扩展的合集，安装一个包即可获得完整的富文本基础能力。

### 3.1 v3 包含的扩展

**Nodes（节点）：**

| 扩展                       | 说明                  |
| -------------------------- | --------------------- |
| `Document`                 | 文档根节点            |
| `Paragraph`                | 段落                  |
| `Text`                     | 文本节点              |
| `Heading`                  | 标题（H1-H6）         |
| `Blockquote`               | 引用块                |
| `BulletList / OrderedList` | 无序/有序列表         |
| `ListItem`                 | 列表项                |
| `CodeBlock`                | 代码块                |
| `HardBreak`                | 硬换行（Shift+Enter） |
| `HorizontalRule`           | 分隔线                |

**Marks（标记）+ Extensions：**

| 扩展               | 说明                  |
| ------------------ | --------------------- |
| `Bold`             | 粗体                  |
| `Italic`           | 斜体                  |
| `Strike`           | 删除线                |
| `Code`             | 行内代码              |
| **`Link`**         | 链接（v3 新增）       |
| **`Underline`**    | 下划线（v3 新增）     |
| `Dropcursor`       | 拖拽光标指示          |
| `Gapcursor`        | 间隙光标              |
| `Undo/Redo`        | 撤销/重做             |
| **`ListKeymap`**   | 列表快捷键（v3 新增） |
| **`TrailingNode`** | 末尾空节点（v3 新增） |

### 3.2 配置 StarterKit

```ts
import StarterKit from "@tiptap/starter-kit";

const editor = useEditor({
	extensions: [
		StarterKit.configure({
			heading: { levels: [1, 2, 3] }, // 限制标题级别
			codeBlock: false, // 禁用内置代码块（替换为 CodeBlockLowlight）
			link: false, // 禁用内置链接（替换为自定义 Link）
		}),
	],
});
```

### 3.3 替换 StarterKit 中的扩展

```ts
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

const editor = useEditor({
	extensions: [
		StarterKit.configure({
			link: false, // 先禁用内置 Link
		}),
		Link.configure({
			autolink: true,
			openOnClick: false,
		}),
	],
});
```

---

## 4. 常用扩展

### 4.1 Placeholder（占位符）

```bash
npm install @tiptap/extension-placeholder
```

```tsx
import { Placeholder } from "@tiptap/extension-placeholder";

Placeholder.configure({
	placeholder: "Write something...",
	// 或根据节点类型显示不同占位符：
	placeholder: ({ node }) => {
		if (node.type.name === "heading") return "What's the title?";
		return "Can you add some further context?";
	},
	emptyEditorClass: "is-editor-empty",
	emptyNodeClass: "is-empty",
	showOnlyCurrent: true,
	showOnlyWhenEditable: true,
});
```

**必需的 CSS：**

```css
.tiptap p.is-editor-empty:first-child::before {
	color: #adb5bd;
	content: attr(data-placeholder);
	float: left;
	height: 0;
	pointer-events: none;
}
```

### 4.2 Link（链接）

```bash
npm install @tiptap/extension-link
```

```tsx
import Link from "@tiptap/extension-link";

Link.configure({
	openOnClick: false, // 编辑模式下不跳转
	autolink: true, // 自动识别 URL 并转为链接
	defaultProtocol: "https",
	protocols: ["http", "https"],
	HTMLAttributes: {
		rel: "noopener noreferrer",
		target: "_blank",
	},
	isAllowedUri: (url, ctx) => {
		return ctx.defaultValidate(url) && !url.startsWith("./");
	},
});

// 命令用法
editor.commands.setLink({ href: "https://example.com" });
editor.commands.unsetLink();
editor.getAttributes("link").href; // 获取当前链接地址
```

### 4.3 Image（图片）

```bash
npm install @tiptap/extension-image
```

```tsx
import Image from "@tiptap/extension-image";

Image.configure({
	inline: false, // 块级图片
	allowBase64: true, // 允许 base64 编码
	HTMLAttributes: { class: "editor-image" },
	// v3 支持可调整大小
	resize: {
		enabled: true,
		alwaysPreserveAspectRatio: true,
	},
});

editor.commands.setImage({
	src: "https://example.com/photo.png",
	alt: "Photo description",
	title: "Caption",
});
```

### 4.4 TableKit（表格）

```bash
npm install @tiptap/extension-table
```

```tsx
import { TableKit } from "@tiptap/extension-table";

// v3 合并包：Table + TableCell + TableHeader + TableRow
TableKit.configure({
	table: { resizable: true },
});

// 常用命令
editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
editor.commands.addColumnBefore() / addColumnAfter() / deleteColumn();
editor.commands.addRowBefore() / addRowAfter() / deleteRow();
editor.commands.mergeCells() / splitCell();
editor.commands.toggleHeaderRow() / toggleHeaderColumn() / toggleHeaderCell();
editor.commands.deleteTable() / fixTables();
```

### 4.5 CodeBlockLowlight（代码高亮）

```bash
npm install lowlight @tiptap/extension-code-block-lowlight
```

```tsx
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { all, createLowlight } from "lowlight";

// 加载所有语言
const lowlight = createLowlight(all);

// 或按需加载以减小体积：
// import { common } from 'lowlight'
// const lowlight = createLowlight(common)

CodeBlockLowlight.configure({
	lowlight,
	defaultLanguage: "plaintext",
	enableTabIndentation: true,
	tabSize: 2,
});
```

### 4.6 TaskList / TaskItem（任务列表）

```bash
npm install @tiptap/extension-list
```

```tsx
import { TaskList, TaskItem } from "@tiptap/extension-list";

// 输入 [ ] 或 [x] 自动转换为任务列表
TaskItem.configure({ nested: true });
```

### 4.7 Highlight（高亮）

```bash
npm install @tiptap/extension-highlight
```

```tsx
import Highlight from "@tiptap/extension-highlight";

Highlight.configure({
	multicolor: true, // 允许多种高亮颜色
});

editor.commands.toggleHighlight({ color: "#fef08a" });
editor.commands.unsetHighlight();
```

---

## 5. 工具栏：BubbleMenu 与 FloatingMenu

v3 底层从 tippy.js 迁移到 **Floating UI**，定位更灵活可靠。

### 5.1 BubbleMenu（选中文本时弹出）

```tsx
import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState } from "@tiptap/react";

function MyEditor() {
	const editor = useEditor({
		extensions: [StarterKit],
		content: "<p>选中文本后弹出菜单</p>",
	});

	const { isBold, isItalic } = useEditorState({
		editor,
		selector: (ctx) => ({
			isBold: ctx.editor.isActive("bold") ?? false,
			isItalic: ctx.editor.isActive("italic") ?? false,
		}),
	});

	return (
		<>
			{editor && (
				<BubbleMenu
					editor={editor}
					options={{ placement: "bottom", offset: 8, flip: true }}
					// 按条件显示：仅在特定节点上显示
					shouldShow={({ editor }) =>
						editor.isActive("image") || editor.isActive("link")
					}
				>
					<div className="bubble-menu">
						<button
							onClick={() => editor.chain().focus().toggleBold().run()}
							className={isBold ? "is-active" : ""}
						>
							Bold
						</button>
						<button
							onClick={() => editor.chain().focus().toggleItalic().run()}
							className={isItalic ? "is-active" : ""}
						>
							Italic
						</button>
					</div>
				</BubbleMenu>
			)}
			<EditorContent editor={editor} />
		</>
	);
}
```

### 5.2 FloatingMenu（空行处弹出）

```tsx
import { FloatingMenu } from "@tiptap/react/menus";

// 适合放置插入类操作（标题、列表、图片等）
<FloatingMenu editor={editor}>
	<div className="floating-menu">
		<button
			onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
		>
			H1
		</button>
		<button onClick={() => editor.chain().focus().toggleBulletList().run()}>
			List
		</button>
		<button
			onClick={() => editor.chain().focus().setImage({ src: "/img.png" }).run()}
		>
			Image
		</button>
	</div>
</FloatingMenu>;
```

### 5.3 多个 BubbleMenu

通过 `pluginKey` 区分，可实现不同选区条件下显示不同菜单：

```tsx
<BubbleMenu editor={editor} pluginKey="formatMenu" options={{ placement: 'top' }}>
  {/* 格式菜单 */}
</BubbleMenu>
<BubbleMenu editor={editor} pluginKey="imageMenu" options={{ placement: 'bottom' }}>
  {/* 图片操作菜单 */}
</BubbleMenu>
```

---

## 6. 自定义扩展

### 6.1 自定义 Extension（纯功能）

```ts
import { Extension } from "@tiptap/core";

const CharacterCount = Extension.create({
	name: "characterCount",

	// 扩展级 Storage（可在运行时读取）
	addStorage() {
		return { count: 0 };
	},

	// 添加全局属性（应用到多个节点类型）
	addGlobalAttributes() {
		return [
			{
				types: ["heading", "paragraph"],
				attributes: {
					textAlign: {
						default: "left",
						renderHTML: (attributes) => ({
							style: `text-align: ${attributes.textAlign}`,
						}),
						parseHTML: (element) => element.style.textAlign || "left",
					},
				},
			},
		];
	},

	onUpdate({ editor }) {
		const text = editor.getText();
		this.storage.count = text.length;
	},
});

// 外部读取 storage
console.log(editor.storage.characterCount.count);
```

### 6.2 自定义 Node（节点）

```ts
import { Node } from "@tiptap/core";

const Callout = Node.create({
	name: "callout",

	group: "block", // block=块级, inline=内联
	content: "inline+", // 允许的子内容
	draggable: true, // 可拖拽
	isolating: true, // 不可被外部编辑影响

	addAttributes() {
		return {
			type: {
				default: "info",
				parseHTML: (element) => element.getAttribute("data-type"),
				renderHTML: (attributes) => ({
					"data-type": attributes.type,
				}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "div[data-callout]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["div", { ...HTMLAttributes, "data-callout": "" }, 0]; // 0 = 子内容占位符
	},

	addCommands() {
		return {
			insertCallout:
				(attributes) =>
				({ commands }) => {
					return commands.insertContent({
						type: this.name,
						attrs: attributes,
					});
				},
		};
	},
});
```

### 6.3 自定义 Mark（标记）

```ts
import { Mark } from "@tiptap/core";

const ColorHighlight = Mark.create({
	name: "colorHighlight",
	inclusive: false, // 不自动包含后续输入

	addAttributes() {
		return {
			color: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-color"),
				renderHTML: (attributes) => ({
					"data-color": attributes.color,
					style: `background-color: ${attributes.color}`,
				}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "mark[data-color]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["mark", HTMLAttributes, 0];
	},

	addCommands() {
		return {
			setColorHighlight:
				(attributes) =>
				({ commands }) => {
					return commands.setMark(this.name, attributes);
				},
			toggleColorHighlight:
				(attributes) =>
				({ commands }) => {
					return commands.toggleMark(this.name, attributes);
				},
			unsetColorHighlight:
				() =>
				({ commands }) => {
					return commands.unsetMark(this.name);
				},
		};
	},
});
```

### 6.4 扩展现有扩展

```ts
import Heading from "@tiptap/extension-heading";

// 修改默认选项
const CustomHeading = Heading.extend({
	addOptions() {
		return { ...this.parent?.(), levels: [1, 2, 3] };
	},
});

// 自定义 HTML 渲染
import Bold from "@tiptap/extension-bold";
const CustomBold = Bold.extend({
	renderHTML({ HTMLAttributes }) {
		return ["b", HTMLAttributes, 0]; // 用 <b> 代替 <strong>
	},
});

// 覆盖键盘快捷键
import BulletList from "@tiptap/extension-bullet-list";
const CustomBulletList = BulletList.extend({
	addKeyboardShortcuts() {
		return {
			"Mod-l": () => this.editor.commands.toggleBulletList(),
		};
	},
});
```

---

## 7. 内容序列化与持久化

Tiptap 推荐使用 **JSON** 作为存储格式，比 HTML 更灵活、更易解析和转换。

### 7.1 获取内容

```js
// HTML
const html = editor.getHTML();
// => '<p>Hello World!</p>'

// JSON
const json = editor.getJSON();
// => { type: 'doc', content: [{ type: 'paragraph', content: [...] }] }

// 纯文本
const text = editor.getText();
const textWithBreaks = editor.getText({ blockSeparator: "\n\n" });
```

### 7.2 设置内容

```js
// 从 HTML 设置
editor.setContent("<p>New content</p>");

// 从 JSON 设置
editor.setContent({
	type: "doc",
	content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
});

// 在指定位置插入
editor.commands.insertContent("<p>Inserted</p>");
editor.commands.insertContentAt(5, "<p>At position 5</p>");
```

### 7.3 持久化方案

**方案一：LocalStorage（简单场景）**

```js
// 保存
localStorage.setItem("editorContent", JSON.stringify(editor.getJSON()));

// 恢复
const saved = localStorage.getItem("editorContent");
if (saved) {
	editor.setContent(JSON.parse(saved));
}
```

**方案二：API 持久化（生产环境）**

```js
// 保存到后端
await fetch("/api/documents", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ content: editor.getJSON() }),
});

// 从后端恢复
const res = await fetch("/api/documents");
const data = await res.json();
editor.setContent(data.content);
```

**方案三：Debounced 自动保存**

```tsx
import { useEffect } from "react";

useEffect(() => {
	if (!editor) return;
	const timer = setTimeout(() => {
		localStorage.setItem("editor", JSON.stringify(editor.getJSON()));
	}, 1000); // 1 秒防抖
	return () => clearTimeout(timer);
}, [editor, editor?.state]);
```

---

## 8. 事件系统

### 事件一览

| 事件              | 触发时机          | 常用场景           |
| ----------------- | ----------------- | ------------------ |
| `beforeCreate`    | 视图创建前        | 预初始化配置       |
| `create`          | 完全初始化        | 设置初始状态       |
| `update`          | 内容变化          | 自动保存、字数统计 |
| `selectionUpdate` | 选区变化          | 更新工具栏状态     |
| `transaction`     | 任何状态变更      | 调试、日志         |
| `focus` / `blur`  | 焦点变化          | UI 状态切换        |
| `destroy`         | 实例销毁          | 清理资源           |
| `paste` / `drop`  | 粘贴 / 拖放       | 内容预处理         |
| `delete`          | 内容删除（v3）    | 删除检测、提示     |
| `contentError`    | 内容不匹配 schema | 错误处理           |

### 注册方式

**方式一：useEditor 配置（最常用）**

```tsx
const editor = useEditor({
	extensions: [StarterKit],
	onUpdate({ editor }) {
		const html = editor.getHTML();
		// 自动保存、同步等
	},
	onSelectionUpdate({ editor }) {
		// 更新工具栏高亮状态
	},
	onFocus({ editor, event }) {
		// UI 切换
	},
	onBlur({ editor, event }) {
		// UI 切换
	},
	onDestroy() {
		// 清理资源
	},
	onDelete({ type, deletedRange, node, mark }) {
		// v3 新增：检测节点或标记被删除
		if (type === "node") {
			console.log("节点被删除:", node.type.name);
		}
	},
});
```

**方式二：运行时绑定/解绑**

```js
const handler = ({ editor }) => {
	/* ... */
};
editor.on("update", handler);
editor.off("update", handler);
```

**方式三：在扩展中注册**

```ts
const MyExtension = Extension.create({
	onUpdate({ editor }) {
		console.log("内容变化了");
	},
});
```

---

## 9. 命令系统

### 9.1 链式调用（推荐）

```js
// 多个命令合并为单个事务，只触发一次 update 事件
editor.chain().focus().toggleBold().toggleItalic().run();
```

### 9.2 试运行命令

```js
// 不实际执行，检查是否可行
if (editor.can().toggleBold()) {
	// 可以执行粗体
}

if (editor.can().chain().toggleBold().toggleItalic().run()) {
	// 两个命令都可以执行
}
```

### 9.3 内联命令

```js
editor
	.chain()
	.focus()
	.command(({ tr }) => {
		tr.insertText("直接操作事务");
		return true;
	})
	.run();
```

### 9.4 常用命令速查

| 类别     | 命令                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| **格式** | `toggleBold()` / `toggleItalic()` / `toggleStrike()` / `toggleUnderline()` / `toggleCode()` / `toggleHighlight()`      |
| **链接** | `setLink()` / `unsetLink()`                                                                                            |
| **内容** | `setContent()` / `insertContent()` / `insertContentAt()` / `clearContent()`                                            |
| **选区** | `focus()` / `blur()` / `selectAll()` / `deleteSelection()` / `scrollIntoView()`                                        |
| **块级** | `toggleHeading({ level })` / `toggleBulletList()` / `toggleOrderedList()` / `toggleBlockquote()` / `toggleCodeBlock()` |
| **插入** | `insertImage()` / `insertTable()` / `insertHorizontalRule()`                                                           |
| **标记** | `setMark()` / `toggleMark()` / `unsetMark()` / `unsetAllMarks()`                                                       |
| **节点** | `setNode()` / `clearNodes()` / `liftListItem()` / `sinkListItem()`                                                     |
| **表格** | `insertTable()` / `addColumnAfter()` / `addRowAfter()` / `mergeCells()` / `splitCell()` / `deleteTable()`              |

---

## 10. 样式与主题定制

Tiptap 采用 **Headless-first** 策略，核心不包含任何样式，完全由你控制。

### 10.1 基础 CSS 样式

编辑器内容渲染在 `.tiptap` 容器中：

```css
/* 基础 */
.tiptap {
	outline: none;
}

/* 段落 */
.tiptap p {
	margin: 1em 0;
	line-height: 1.7;
}

/* 标题 */
.tiptap h1 {
	font-size: 2em;
	font-weight: bold;
}
.tiptap h2 {
	font-size: 1.5em;
	font-weight: bold;
}
.tiptap h3 {
	font-size: 1.25em;
	font-weight: bold;
}

/* 列表 */
.tiptap ul,
.tiptap ol {
	padding-left: 1.5em;
}

/* 引用 */
.tiptap blockquote {
	border-left: 3px solid #d1d5db;
	padding-left: 1em;
	color: #6b7280;
}

/* 代码块 */
.tiptap pre {
	background: #1e1e1e;
	color: #d4d4d4;
	border-radius: 6px;
	padding: 1em;
	font-family: "JetBrains Mono", monospace;
}

/* 图片 */
.tiptap img {
	max-width: 100%;
	height: auto;
	border-radius: 8px;
}

/* 链接 */
.tiptap a {
	color: #4f46e5;
	text-decoration: underline;
	cursor: pointer;
}

/* 表格 */
.tiptap table {
	border-collapse: collapse;
	width: 100%;
}
.tiptap table td,
.tiptap table th {
	border: 1px solid #e2e5ea;
	padding: 0.5em;
}

/* 任务列表 */
.tiptap ul[data-type="taskList"] {
	list-style: none;
	padding-left: 0;
}
.tiptap ul[data-type="taskList"] li {
	display: flex;
	align-items: flex-start;
	gap: 0.5rem;
}
.tiptap ul[data-type="taskList"] li label input[type="checkbox"] {
	margin-top: 0.3rem;
}
```

### 10.2 添加 Tailwind Typography 类

```tsx
const editor = useEditor({
	editorProps: {
		attributes: {
			class:
				"prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none",
		},
	},
});
```

### 10.3 给扩展节点添加 CSS 类

```ts
Paragraph.configure({
	HTMLAttributes: { class: "my-paragraph" },
});
Heading.configure({
	HTMLAttributes: { class: "my-heading" },
});
// 渲染结果：<h1 class="my-heading">...</h1>
```

### 10.4 Tailwind CSS 集成（编辑器内样式）

```css
.tiptap {
	p {
		@apply my-4 first:mt-0 last:mb-0 text-base leading-relaxed;
	}
	h1 {
		@apply text-3xl font-bold mt-8 mb-4 first:mt-0 last:mb-0;
	}
}
```

### 10.5 VSCode Tailwind Intellisense 配置

```json
// .vscode/settings.json
{
	"tailwindCSS.experimental.classRegex": ["class:\\s*?[\"'`]([^\"'`]*).*?,"]
}
```

---

## 11. v3 新特性

### 11.1 MarkView（React & Vue 3）

Marks 可像 Nodes 一样拥有交互式渲染能力，支持事件处理器。例如：为链接添加点击预览、为高亮文本添加删除按钮。

### 11.2 SSR 原生支持

```tsx
"use client";

export function MyEditor() {
	const editor = useEditor({
		extensions: [StarterKit],
		content: "<p>Hello World!</p>",
		immediatelyRender: false, // 防止 SSR 渲染
	});

	if (!editor) return null;
	return <EditorContent editor={editor} />;
}
```

也支持延迟挂载：

```js
const editor = new Editor({
	element: null, // 先不绑定 DOM
	extensions: [StarterKit],
});

// 后续挂载
editor.mount(document.querySelector(".element"));
```

### 11.3 Enhanced TypeScript 支持

- 扩展 Storage 支持类型定义（使用命名空间）
- Node、Mark、Extension 的 config options 现在是强类型的
- 防止在 options 对象上使用任意键

### 11.4 JSX 支持

`renderHTML` 方法支持 JSX 语法：

```js
renderHTML({ HTMLAttributes }) {
  return <strong {...HTMLAttributes}>0</strong>
}
```

### 11.5 扩展的 StarterKit

v3 StarterKit 新增：**Underline**、**Link**、**ListKeymap**、**TrailingNode**

### 11.6 合并包（Consolidated Packages）

v3 将相关扩展合并到统一包中，减少依赖数量：

- **TableKit** = Table + TableCell + TableHeader + TableRow
- **ListKit** = BulletList + OrderedList + TaskList + TaskItem + ListItem

### 11.7 @tiptap/static-renderer

无需浏览器/DOM，将 Tiptap 文档渲染为 HTML、Markdown 或 React 组件。

### 11.8 Floating UI 替代 tippy.js

BubbleMenu 和 FloatingMenu 底层改用 Floating UI，消除渲染问题并提供更灵活的定位 API。

### 11.9 删除检测事件

```js
onDelete({ type, deletedRange, newRange, node, mark }) {
  if (type === 'node') {
    console.log('节点被删除:', node.type.name, deletedRange)
  }
  if (type === 'mark') {
    console.log('标记被删除:', mark.type.name)
  }
}
```

### 11.10 从 v2 迁移

Tiptap 官方提供了详细的迁移指南（[tiptap.dev/docs/migration/v3](https://tiptap.dev/docs/migration/v3)），主要涉及：

- 包名变更（部分扩展合并为 TableKit、ListKit）
- `immediatelyRender` SSR 设置
- BubbleMenu / FloatingMenu import 路径变更（`@tiptap/react/menus`）
- Extension Storage 类型定义方式变更

---

## 参考来源

1. [Tiptap 3.0 发布页](https://tiptap.dev/tiptap-editor-v3)
2. [Tiptap React 安装指南](https://tiptap.dev/docs/editor/getting-started/install/react)
3. [Tiptap 核心概念](https://tiptap.dev/docs/editor/core-concepts/introduction)
4. [StarterKit 扩展](https://tiptap.dev/docs/editor/extensions/functionality/starterkit)
5. [BubbleMenu 扩展](https://tiptap.dev/docs/editor/extensions/functionality/bubble-menu)
6. [持久化指南](https://tiptap.dev/docs/editor/core-concepts/persistence)
7. [事件 API](https://tiptap.dev/docs/editor/api/events)
8. [命令 API](https://tiptap.dev/docs/editor/api/commands)
9. [样式指南](https://tiptap.dev/docs/editor/getting-started/style-editor)
10. [自定义扩展](https://tiptap.dev/docs/editor/extensions/custom-extensions)
11. [Editor 实例 API](https://tiptap.dev/docs/editor/api/editor)
