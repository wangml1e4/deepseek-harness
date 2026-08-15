# @deepseek-ai/dsh-client-ui-settings-token-usage

[English](README.md) | 中文

面向 800px 设置 shell 的独立 Token 用量页面。浏览器插件注册一项 `settings.section`，读取框架提供的 root `useSessions` hook，并通过注入的 `ctx.sessions` face 获得投影补齐能力。页面对会话列表中的每个唯一 id 只折叠一次。`tokenActivity` 投影会丢弃复制的种子前缀，因此普通会话、fork 会话与 subagent 会话沿用产品现有的可见列表范围，不会把同一个提供方请求计费多次。

页面合并每个可见持久会话的 durable `tokenActivity` 投影。总量为未缓存输入、缓存读取、缓存写入和输出之和；不会单独再加推理 token。页面会串行请求 sessions 服务为每个可见行提供精确的仅投影 baseline，因为已有的 cold cache 值仍可能陈旧。Host 读取 live 注册表 cut 或 cold cache ladder，并把重建后的冷 checkpoint 写回；`session.list` 本身仍保持零全日志 I/O。加载中、按会话失败与真正的零用量状态分别呈现。

## 日历语义

日界线使用浏览器的显式 IANA 时区。每日视图从当前日历月向前覆盖十一个月，以周一为首日显示七行网格；每周视图覆盖 52 个周一开始的周；每月视图覆盖 12 个日历月。峰值 Token 按当前选中视图中的可见周期重新计算。累计 Token 与连续活跃天数使用全部已投影历史。

Token 总量大于零的自然日是活跃日。若今天活跃，当前连续记录截至今天；否则允许截至昨天；两天都不活跃时为零。最长连续记录覆盖全部历史。最长已完成工作是投影提供的、持久日志中匹配 `turn/start` 到成功 `turn/end` 的最大时间间隔。

五项摘要组成一个带分隔线的统计条，数值在上、标签在下，窄宽度时换为两列。视觉数值使用本地化紧凑格式，title 与 accessible name 则公开完整整数；时长使用本地化的小时／分／秒单位。每个真实热力块都是可用键盘聚焦的按钮，以日期或周期和精确 Token 数命名；强度图例与中性零值网格补充颜色表达。

## 组合

```yaml
- name: '@deepseek-ai/dsh-client-ui-settings-token-usage'
```

本包要求客户端 runtime、settings 与 locale 插件。Host 半部为空；浏览器半部的全部注册都由 Cordis effect 持有。

## 模型体验

无，因为该页面只渲染持久投影，不会添加提示词、消息、工具、schema、模型调用或会话日志事件。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 精确投影加载失败时，已知会话仍可见，页面会标明统计不完整；列表行不携带精确性标志，因此“重试”会重新检查每个可见 id。失败绝不会呈现成真正的零值状态。
- 每个服务商 bucket 延续现有 number 契约；客户端在跨会话相加前把 bucket 转为 `bigint`，因此格式化不会引入额外精度损失。
