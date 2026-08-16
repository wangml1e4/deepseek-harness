# @deepseek-ai/dsh-taskctl

[English](README.md) | 中文

`taskctl` 是 DeepSeek Harness Taskboard Host Remote 的机器可读 CLI。其命令语法改造自 Dashi Taskboard 的 Apache-2.0 CLI，并针对 Workspace 身份、Harness 操作者归属、Typert RPC 和禁止删除的生命周期进行了修改。

## 命令与输出

CLI 覆盖 Workspace 元数据；Issue 列表、读取、创建、更新、移动、归档和恢复；只追加的评论与活动记录；附件上传、列表、下载和确认删除；依赖关系；以及 Patrol 策略、历史、手工 Run、Issue 证据和确认清理 worktree 操作。使用 `taskctl <resource> <action>` 调用；选项参考随 [`@deepseek-ai/dsh-skill-manage-taskboard`](../skill-manage-taskboard/README.md) 一起提供。

每次调用只写出一个 JSON 对象。成功输出采用 `{ "schemaVersion": 1, "result": ... }`；失败输出采用 `{ "schemaVersion": 1, "error": { "code", "message" } }`。

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `2` | 命令或选项无效 |
| `3` | Host 不可用或 HTTP 响应不成功 |
| `4` | 响应无效、Remote 载体失败或 Taskboard 业务失败 |
| `5` | 乐观版本冲突 |

默认 Host origin 为 `http://127.0.0.1:3080`；可用 `DSH_TASKBOARD_URL` 覆盖。存在 `CODEX_THREAD_ID` 时，写操作使用它作为操作者 id。`DSH_TASKBOARD_ACTOR_TYPE`、`DSH_TASKBOARD_ACTOR_ID` 和 `DSH_TASKBOARD_ACTOR_NAME` 可显式覆盖归属信息。

每项可能竞争的变更都要求 `--if-version`。`taskctl patrol cleanup ISSUE_ID --workspace WORKSPACE_ID --confirm` 会请求移除物理 worktree；Host 会拒绝不干净或尚未集成的 worktree，并保留 Issue 分支、Session 绑定和历史。CLI 不会自动重试，也不提供 Issue 删除命令。

## 归属说明

参数分发设计改造自 [Dashi Taskboard](https://github.com/chuspeeism/dashi-taskboard)。改造后的源码带有修改声明，[`licenses/Dashi-LICENSE.txt`](licenses/Dashi-LICENSE.txt) 包含上游 Apache License 2.0。

## 模型体验

通过内置 `manage-taskboard` skill 间接影响模型；该 skill 指示 Agent 调用此可执行文件并读取其 JSON 输出。

#### KV Cache 影响

独立于模型请求。只有调用工具把命令结果写入 Session 时，它们才会进入会话。

## 已知限制与暂缓事项

- `taskctl` 需要已运行的 Web Host，不会自行启动 Host。
- Patrol 资格、认领和生命周期回写仍是 Host 所属事务，不由模型编写 CLI 步骤。
- CLI 不会发布或同步 GitHub Issue。
