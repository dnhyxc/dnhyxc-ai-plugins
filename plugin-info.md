# remote-plugins

基座专用 MF 插件包（一仓多 expose）。federation name：`remotePlugins`，开发端口 **9008**。

UI 与主站对齐：**Tailwind CSS v4 + shadcn/ui**（`src/components/ui`、`@` / `@ui` 别名、`components.json`）。`styles.css` 为常规 `:root` / `.dark` token；嵌入 Host 时继承主站变量。

## 样式契约

**隔离由 Host 负责**（`plugins/host/styleIsolation.ts`：运行时 `@scope([data-mf-style-realm])`）。

| Remote 可正常做                                | Host 保证                                 |
| ---------------------------------------------- | ----------------------------------------- |
| `@import "tailwindcss"` 全家桶（含 Preflight） | Remote 注入的 CSS 不会污染主站            |
| **每个 MF expose 入口** `import '@/styles.css'` | 随 expose 注入 CSS（Host **不**跑 `main`） |
| 普通 Vite + Tailwind 工程配置                  | 插件页包装 `data-mf-style-realm` 作为 scope 根 |

完整约定见 Host 侧 [plugin-development-guide.md §5.2](../frontend/src/plugins/docs/plugin-development-guide.md#52-expose-必须引入-stylescss)。Vue 子应用另须 registry `"framework": "vue"`（§4.3）。

`trust: untrusted` 仍走 iframe（见 `docs/ideas/mf-css-isolation.md`）。

## 启动

```bash
pnpm dev:remote-plugins
# 或
pnpm -C apps/remote-plugins dev
```

浏览器打开 `http://127.0.0.1:9008/`：

| 路径                              | 页面                                                     |
| --------------------------------- | -------------------------------------------------------- |
| `/`                               | 插件目录（带预览壳）                                     |
| `/english-learning/notes`         | 学习笔记（预览壳）                                       |
| `/ebook/plugins/ideas-list`       | EPUB 想法列表（预览壳，mock Host）                       |
| `/embed/ebook/plugins/ideas-list` | **Host `iframeUrl` 用这个**：无壳，postMessage 接真 Host |
| `/embed/english-learning/notes`   | 同上，学习笔记 embed                                     |

`trust: untrusted` 时 registry 示例：

```json
"trust": "untrusted",
"iframeUrl": "http://127.0.0.1:9008/embed/ebook/plugins/ideas-list"
```

生产改为对应 https 落地页。勿把带导航栏的 `/ebook/plugins/ideas-list` 填进 `iframeUrl`。

生产构建请设置 `VITE_REMOTE_PUBLIC_ORIGIN`（与 registry `entry` 同源，如 `https://dnhyxc.cn:9008`）。

## 目录（对齐主站 `apps/frontend/src`）

```
src/
  main.tsx                 # 入口 → @/router
  router/                  # 独立预览路由（index + routes）
  layout/                  # 预览壳 Layout
  views/                   # 页面与 MF expose
    home/                  # 插件目录首页
    embed/                 # untrusted iframe 落地页
    ebook/
      ideas/               # expose ./EbookIdeas
      highlights/          # expose ./EbookHighlights
      toolbar-test/        # expose ./EbookTestBookInfo
    learning-notes/        # expose ./LearningNotes
  utils/                   # mockHost、iframeHostClient
  components/ui/           # shadcn（可扩展 design/）
  lib/utils.ts
  styles.css
```

新增 UI：`pnpm dlx shadcn@latest add <component>`（在本包目录下，读 `components.json`）。

## Expose

| expose                | 说明                                                        | registry `id`       |
| --------------------- | ----------------------------------------------------------- | ------------------- |
| `./EbookIdeas`        | EPUB 全书想法列表（阅读页抽屉）                             | `ebookIdeas`        |
| `./EbookHighlights`   | EPUB 全书划线列表（滚动分页）                               | `ebookHighlights`   |
| `./EbookTestBookInfo` | 阅读页 Host 槽测试：书信息 + Toast；`lifecycle` 订阅 locale | `ebookTestBookInfo` |
| `./LearningNotes`     | 英语学习 · 学习笔记（业务页内嵌）                           | `learningNotes`     |

后续新插件：在 `src/views/<name>/` 加模块，并在 `vite.config.ts` `exposes` 与 Host registry 各加一条（共用同一 `remoteName` + `entry`）。

## Registry 示例

```json
{
	"id": "learningNotes",
	"remoteName": "micro",
	"expose": "./LearningNotes",
	"entry": "http://127.0.0.1:9008/mf-manifest.json",
	"injectRoute": false,
	"permissions": ["ui:toast", "nav:subtree"],
	"enabled": true,
	"trust": "first-party"
}
```

## CORS

生产 Remote 须放行 `https://dnhyxc.cn:9002` 与 `tauri://localhost`（见 `docs/ideas/third-party-mf-plugin-onboarding.md`）。Nginx 示例可参考同目录历史 Remote 配置思路，端口改为 **9008**。
