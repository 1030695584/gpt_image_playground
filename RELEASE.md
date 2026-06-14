## v0.6.5（2026-06-14）

### 修复
- **修复 Agent 流式纯文本重复渲染问题** (Issue #100, PR #103)
  - Agent 模式开启流式时，`response.completed` 可能会在 `response.output` 中重新返回同一条 assistant message，但该快照不带 `item.id`。
  - 现在会按输出位置合并这类无 `id` 的完成快照，避免同一段纯文本回复在页面中渲染两次。

### 贡献
- @ZiYang-oyxy 通过 PR #103 贡献了 Agent 流式纯文本重复渲染问题的修复，特此感谢。
