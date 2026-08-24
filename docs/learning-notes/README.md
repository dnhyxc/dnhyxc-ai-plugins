# learning-notes 功能域

学习笔记相关专题实现文档。主文档：[learning-notes.md](../learning-notes.md)（笔记 CRUD / MobX 状态管理 / 长文分页）。

## 文档列表

| 文件 | 说明 |
|------|------|
| [笔记图片上传会话.md](./笔记图片上传会话.md) | 编辑器图片上传会话（uploadSessionId）生命周期：防止「上传又删且未保存」的 COS 孤儿图 |
| [笔记自动保存与离页保存.md](./笔记自动保存与离页保存.md) | 切笔记/新建/预览/关页/离开路由时三层自动保存兜底 + keepalive 保存/结算 |

## 延伸阅读

- [学习笔记主文档](../learning-notes.md) — LearningNotesStore / NotesApi / LargeNoteEditor 总览
- [笔记图片上传会话.md](./笔记图片上传会话.md) — uploadSessionId 与 COS 孤儿图回收（自动保存第三档 settle 会联动）
- [富文本编辑器主文档](../rich-editor.md) — RichEditor / ImageUpload 扩展
