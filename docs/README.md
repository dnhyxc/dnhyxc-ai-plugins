# dnhyxc-ai-plugins 实现文档索引

本目录收录 `dnhyxc-ai-plugins` 项目所有功能模块的详细实现文档。每份文档包含完整源码（带详细中文注释）、实现原理剖析、架构设计图（Mermaid）与核心流程图。

---

## 文档列表

### 🎨 核心组件实现

| 文档 | 功能模块 | 核心技术 | 源码行数 |
|------|----------|----------|----------|
| [rich-editor.md](./rich-editor.md) | **富文本编辑器 (RichEditor)** | Tiptap + ProseMirror | ~2900 行 |
| [video-player.md](./video-player.md) | **视频播放器 (VideoPlayer)** | xgplayer + 自定义控制条 | ~2800 行 |
| [drag-drop-file-upload.md](./drag-drop-file-upload.md) | **拖拽文件上传 (DragDropFileUpload)** | Headless Hook + UI 双层架构 | ~550 行 |
| [note-preview.md](./note-preview.md) | **笔记预览 (NotePreview)** | 静态 HTML 渲染 + CSS Containment | ~200 行 |

### 📚 业务功能实现

| 文档 | 功能模块 | 核心技术 | 源码行数 |
|------|----------|----------|----------|
| [learning-notes.md](./learning-notes.md) | **学习笔记 (Learning Notes)** | MobX + HostBridge + 长文分页 | ~2850 行 |
| [ebook-ideas.md](./ebook-ideas.md) | **电子书想法列表 (Ebook Ideas)** | IntersectionObserver + HostBridge | ~270 行 |
| [ebook-highlights.md](./ebook-highlights.md) | **电子书划线列表 (Ebook Highlights)** | IntersectionObserver + CFI 跳转 | ~270 行 |

### 🏗️ 基础设施实现

| 文档 | 功能模块 | 核心技术 | 说明 |
|------|----------|----------|------|
| [i18n-system.md](./i18n-system.md) | **国际化系统 (i18n)** | globalThis 单例 + 发布-订阅 | zh-CN / en-US 双语 |
| [design-system.md](./design-system.md) | **设计系统组件库** | Radix UI + Tailwind CSS v4 | 11+ 基础组件 |

### 📖 补充文档

| 文档 | 说明 |
|------|------|
| [RichEditor-guide.md](./RichEditor-guide.md) | 富文本编辑器使用指南 |
| [tiptap.md](./tiptap.md) | Tiptap 编辑器技术笔记 |

---

## 技术栈概览

```
┌─────────────────────────────────────────────────────────────┐
│                    dnhyxc-ai-plugins                         │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  编辑器层     │  播放器层     │  状态管理层   │  基础设施层    │
│  Tiptap      │  xgplayer    │  MobX        │  i18n          │
│  ProseMirror │  Canvas API  │  React Hook  │  Module Fed.   │
├──────────────┼──────────────┼──────────────┼────────────────┤
│  组件层       │  UI 层       │  通信层       │  样式层        │
│  Radix UI    │  Tailwind    │  HostBridge  │  CSS Vars     │
│  lucide-react│  clsx/twMerge│  HTTP API    │  CVA          │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

## 架构模式

- **Module Federation**: 插件化架构，通过 `expose` 暴露组件，`loadRemote` 动态加载
- **HostBridge**: 统一的宿主-插件通信协议，封装 API（theme/locale/event/http/ui/modules）
- **Headless + UI 双层架构**: 业务逻辑（Hook）与视觉呈现（组件）分离
- **发布-订阅模式**: i18n locale 切换、事件系统
- **命令式 API**: `forwardRef` + `useImperativeHandle` 暴露 open/reset 等方法
- **IntersectionObserver**: 哨兵元素实现分页懒加载

## 快速导航

```
docs/
├── README.md              ← 你在这里
├── rich-editor.md         ← 富文本编辑器（最复杂组件）
├── video-player.md        ← 视频播放器（含自定义控制条）
├── learning-notes.md     ← 学习笔记（完整 CRUD + MobX）
├── ebook-ideas.md        ← 想法列表（分页懒加载）
├── ebook-highlights.md   ← 划线列表（同构设计）
├── drag-drop-file-upload.md ← 拖拽上传（Headless Hook）
├── note-preview.md       ← 笔记预览（HTML 处理管线）
├── i18n-system.md        ← 国际化（Host 隔离）
├── design-system.md      ← 设计系统（组件库）
├── RichEditor-guide.md   ← 使用指南（补充）
└── tiptap.md             ← 技术笔记（补充）
```

## 如何贡献

1. 新增功能实现后，创建对应的 `.md` 文档放入本目录
2. 文档需包含：概述、架构图（Mermaid）、完整源码（带中文注释）、实现原理、使用示例
3. 更新本 README.md 的文档列表

---

*最后更新: 2025*
