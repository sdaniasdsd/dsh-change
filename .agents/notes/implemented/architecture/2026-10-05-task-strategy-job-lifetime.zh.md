# Agent Note：已接收 task-strategy 运行的生命周期归 Jobs 所有

Status: implemented

[English](2026-10-05-task-strategy-job-lifetime.md) | 中文

## 问题

task-strategy Cordis 载体曾在自身服务作用域内保存每个已接收 Job 的 abort controller 和 promise，并在卸载时取消、排空它们。因此，profile 配置热加载会杀掉仍然有效的任务，尽管 DSH Jobs 契约规定 Job 不随 producer 或 controller 注册的卸载而终止；已接收 Job 由所属 Agent 或 Jobs 后端销毁时才取消。

## 决策

策略载体只拥有策略注册、派发工具与准入。在调用 `jobs.start()` 前，它校验并快照计划、任务、provider 和运行限制。Jobs 接收运行后，producer 及其子任务归 Jobs 记录和所属 Agent 所有，不再归载体 fiber 所有。载体卸载时关闭准入并移除注册；既不取消，也不等待已接收的 Job。显式取消使用 `job_kill`。Agent 销毁和 Jobs 后端关闭仍通过现有 Jobs 契约取消并排空任务。

## 已考虑的替代方案

- **载体卸载时仍取消运行中的任务。** 否决：配置热加载不是显式取消请求，而且 producer 重载按定义不应终止 Job。
- **修改通用 HMR 或 Jobs teardown，使更多任务存活。** 否决：两者已有所需的生命周期边界；额外取消是 task-strategy 引入的。
- **在 Jobs 后端或进程关闭后持久化、转移任务。** 否决：Jobs 是进程内的，重启恢复不属于该载体契约。

## 结果

- 新派发立即使用替换后的配置；已接收运行按捕获的计划和限制完成。
- 已有 Job 可能与新加载的策略载体并行运行。适配器热加载不再代替 `job_kill`。
- 移除底层 subagent/provider 依赖，或销毁所属 Agent/Jobs 后端，仍可能按各自所有者的契约取消子任务。

## 测试

- `packages/experimental/task-strategy/tests/adapter.spec.ts` 验证载体卸载会移除其工具，但 Job 仍在运行且子任务请求信号未 abort；显式 `job_kill` 仍能结算任务。
- 同一适配器测试文件验证异步 preflight 期间卸载会拒绝派发，且不会创建 Job 或子任务。
- `packages/jobs/jobs-local/tests/jobs.spec.ts` 仍是 Agent 所有权与 Jobs 后端取消行为的依据。
