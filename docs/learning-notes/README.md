# learning-notes 功能域

学习笔记相关专题实现文档。主文档：[learning-notes.md](../learning-notes.md)（笔记 CRUD / MobX 状态管理 / 长文分页）。

## 文档列表

| 文件 | 说明 |
|------|------|
| [笔记图片上传会话.md](./笔记图片上传会话.md) | 编辑器图片上传会话（uploadSessionId）生命周期：防止「上传又删且未保存」的 COS 孤儿图 |
| [笔记自动保存与离页保存.md](./笔记自动保存与离页保存.md) | 切笔记/新建/预览/关页/离开路由时三层自动保存兜底 + keepalive 保存/结算 |
| [跨窗草稿同步与脏标记仲裁.md](./跨窗草稿同步与脏标记仲裁.md) | Host 多窗口同一笔记草稿同步、脏标记三段仲裁、上传会话 adopt/rotate、pendingPeerDraft 时序保护（初始版 connectStore 绑定模式） |
| [跨窗同步重构与离页快照.md](./跨窗同步重构与离页快照.md) | subscribe 分发替代 connectStore、Store 自发广播 saved/deleted、leaveSnap 离页快照、编辑器 epoch 守卫、防抖草稿代际取消 |

## 延伸阅读

- [学习笔记主文档](../learning-notes.md) — LearningNotesStore / NotesApi / LargeNoteEditor 总览
- [笔记图片上传会话.md](./笔记图片上传会话.md) — uploadSessionId 与 COS 孤儿图回收（跨窗 adopt/rotate 是其扩展）
- [笔记自动保存与离页保存.md](./笔记自动保存与离页保存.md) — keepalive 机制；跨窗同步新增 saveTargetId、owned guard
- [跨窗草稿同步与脏标记仲裁.md](./跨窗草稿同步与脏标记仲裁.md) — 初始版同步架构（connectStore 绑定模式）
- [富文本编辑器主文档](../rich-editor.md) — RichEditor / ImageUpload 扩展
