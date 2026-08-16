# @deepseek-ai/dsh-skill-manage-taskboard

[English](README.md) | 中文

内置 `manage-taskboard` skill 提供方。用户和模型无需在本地安装 skill，即可使用 Workspace Taskboard 工作流。

## 工作流

该 skill 指示 Agent 使用 `taskctl` 执行持久 Issue、评论、活动记录、附件和关系操作。它要求 Agent 先读取 Issue 及其最新评论，只能通过移至 `in_progress` 认领 `todo` 工作；发生一次乐观冲突后，只有重新读取当前状态才能重试一次；同时保留无关工作，且绝不删除 Issue。

CLI 参考也覆盖 Patrol 策略、Run、Issue 证据和受保护的 worktree 清理。只有用户明确要求时，该 skill 才允许修改 Patrol 设置、启动手工 Run 或移除 worktree；资格判定、认领、Session 绑定、审批处理、审查、生命周期回写和清理前提仍由 Host 持有。

提交人工审查前，Agent 必须审查变更、应用必要修正、运行验证、创建 commit、追加结果和剩余风险，把 Issue 移至 `in_review`，并结束当前执行轮次。该 skill 绝不授权 Agent 把工作移至 `done`；完成状态由人工验收持有。

提供方注册名为 `manage-taskboard` 的全局内置候选项。它同时允许模型和用户调用，资源目录包含详细的 `taskctl` 命令参考。

## 归属说明

工作流和 CLI 参考改造自 [Dashi Taskboard](https://github.com/chuspeeism/dashi-taskboard)，并带有修改声明。[`licenses/Dashi-LICENSE.txt`](licenses/Dashi-LICENSE.txt) 包含上游 Apache License 2.0。

## 模型体验

### Skill 目录

#### 模型看到的内容

面向模型的 skill 目录包含 `manage-taskboard` 名称和有长度上限的描述。

#### Token 影响

skill 目录可见时包含一个固定的名称与描述项。

#### KV Cache 影响

稳定条目参与初始 skill 目录；只要其名称和描述不变，就保持前缀稳定。

### 已加载工作流

#### 模型看到的内容

加载 skill 会把工作流正文和资源基底指引加入保留的工具历史；只有需要命令语法时才读取详细 CLI 参考。

#### Token 影响

包含工作流正文的一项数据相关 skill 结果；只有 Agent 读取 CLI 文档时，才会再产生对应内容。

#### KV Cache 影响

以追加方式位于可复用请求前缀之后；加载不会改变更早的请求内容。

## 已知限制与暂缓事项

- 该 skill 需要内置 `taskctl` 可执行文件和已运行的 Web Host。
- Patrol 启动恢复不属于该交互工作流，由 Host Patrol 消费方负责。
