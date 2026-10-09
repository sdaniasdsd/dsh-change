---
kind: upgrade-guide
description: "实验性任务策略的切换与恢复命令要求调用方观察到的绑定版本。"
---

# 任务策略控制命令的版本校验

[English](guide.md) | 中文

## 变更

公开的实验性任务策略包要求切换与恢复命令携带已观察到的绑定版本。`TaskSwitch` 增加必填字段 `expectedBindingEpoch`，载体 `resume(parent, jobId, expectedBindingEpoch)` 增加第三个参数。直接调用方使用 `TaskRun.requestSwitch(load, { expectedBindingEpoch, startStage })` 和 `TaskRun.resume(expectedBindingEpoch)`。此前直接切换的第二个参数表示目标阶段，控制命令不要求版本。运行时在执行作者函数或改变任务状态之前同步拒绝无效或不匹配的版本。通过原版 Jobs 取消任务的方式不变。

## 迁移

1. 通过 `inspect(parent, jobId)` 或 `run.inspect()` 读取用于决定控制操作的任务视图，并保留其中的 `binding.epoch`。
2. 为宿主切换请求添加 `expectedBindingEpoch: view.binding.epoch`，向宿主或直接恢复调用传入该版本。
3. 直接切换调用将原来的数字游标参数替换为 `{ expectedBindingEpoch: view.binding.epoch, startStage: oldCursor }`；省略 `startStage` 时从阶段 0 开始。显式对象让旧的数字调用在编译时失败，避免把阶段序号误当成版本。适配器不能用当前版本替换调用方较早的预期值。
4. 遇到版本不匹配时重新读取视图，并明确重新决定操作。编译调用方，验证旧版本不能改变绑定、调用作者函数或恢复等待中的任务。参见[包文档](../../../../packages/experimental/task-strategy/README.zh.md)。
