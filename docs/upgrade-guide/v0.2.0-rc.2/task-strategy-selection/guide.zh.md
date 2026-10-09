---
kind: upgrade-guide
description: "实验性任务策略入口增加有界自动选择，并在回执中标明所选策略。"
---

# 任务策略选择与回执

[English](guide.md) | 中文

## 变更

`TaskReceipt` 在 `jobId`、`name` 之外要求提供 `strategy`。按需启用的载体增加 `submitTask` 和 `task_strategy_submit`；原有直接提交仍指定策略。自动选择调用一个原版子 Agent，禁用继承的业务工具，限制输出并设置截止时间。任务无需用户答复即可继续；选择失败会在创建执行 Job 前拒绝。

载体解析后的配置将可编辑的 `selection` 字段包装为 Cordis `Volatile` 引用。Loader 原始配置仍使用普通数据。每次新提交捕获当时的值；已接受的 Job 保留自己的执行配置。

提交工具回执保持合法 JSON，并保留完整 Job 与策略标识，只缩短过长的显示名称。入口在接受 Job 前拒绝超过载体 `maxOutputBytes` 减去 256 元数据字节预算的 JSON 编码策略标识。这里使用载体输出上限，与选择器的 `selection.maxOutputBytes` 分开。

重新挂载后调小上限，如果无法容纳旧回执，工具通过明确错误报告已接收的 Job id。读取该 Job，或恢复此前的上限并重复原请求；不要创建新请求标识。宿主完整回执和去重预留仍可使用。

## 迁移

1. 在回执生产者与测试样例中增加 `strategy`，用它标识本次接受的作者策略。
2. 向 `submitTask` 提供 `requestId` 和原始非空任务。不传 `selection` 使用插件默认值；传 `{ kind: 'auto' }` 自动选择；传 `{ kind: 'named', strategy: 'your-id' }` 跳过选择模型。重复调用保留原始标识与输入。
3. 在 Loader 中配置 `selection.default`、`timeoutMs`、`maxPromptBytes`、`maxOutputBytes` 与 `maxTokens`。默认分别为自动、30,000 毫秒、32,768 字节、2,048 字节和 512 token。插件页提供默认模式、模型/provider 及截止时间设置。模型及 provider 留空继承父 Agent 路由。直接调用构造函数时，使用载体 `Config` schema 的解析结果。
4. 可选的限时提问仍通过提交之前的原版根工具调用完成。未答复保留默认值；迟到答复不重复提交原任务。已接受的任务通过[现有绑定控制](../task-strategy-binding-commands/guide.zh.md)修改。
5. 插件界面需要保存默认值时，将按需启用的载体放入活跃 profile 补丁。命令行策略覆盖层优先，因此原版 ConfigEditor 会拒绝冲突的界面保存并保留草稿。参见[源码试用说明](../../../../packages/experimental/task-strategy/README.zh.md#use-this-package)。

详见[包契约](../../../../packages/experimental/task-strategy/README.zh.md)。
