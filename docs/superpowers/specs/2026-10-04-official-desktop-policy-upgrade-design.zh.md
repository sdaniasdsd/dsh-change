# 官方桌面版与任务策略升级设计

[English](2026-10-04-official-desktop-policy-upgrade-design.md) | 中文

## 目标

以官方 `dsh-v0.2.1-alpha.1` 预发布版本为基础构建 Windows x64 Desktop，并迁入现有的独立任务策略能力和用户当前 DSH 插件。Desktop 外壳、DSH 运行时、内置组合包、插件管理器及上游行为均以官方版本为准。构建产物是候选的未来开发和日常使用版本；在用户试用前，不替换现有安装或 profile。

采用的上游源码是标签 `dsh-v0.2.1-alpha.1`，提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。这是预发布版本，因此构建和交付说明必须标明预发布，不能称作稳定版。

## 组件边界

任务策略仍是作者决策/策略组件，不是 DSH 插件注册表，也不是插件管理功能。它选择具名策略、生成有序执行计划，并跟踪被分发任务的进展。具体任务仍由原版 DSH jobs、agents、subagents、tools 和执行生命周期完成。

现有可选 Cordis carrier 只是把独立策略库接入 DSH 的适配层。库与 carrier 保持独立导出，并在 Desktop profile 中显式选择启用。不能把作者策略变成插件条目，也不能静默改变默认执行路径。如果能在不改变子任务权限或生命周期语义的前提下适配到当前上游 subagent API，则保留一次性 agent preset 覆盖行为。

## 迁移方式

从精确的官方发布源码树开始，有选择地移植功能。不得整体合并旧分支、重置现有 main 分支，或用旧包/目录快照覆盖上游文件。Desktop、Web、插件、运行时和生成目录以上游为准；将冲突的策略/subagent 代码适配到当前上游 API，然后从所属源文件重新生成派生目录和成对文档。

迁入独立的 `@deepseek-ai/dsh-experimental-task-strategy` 包、测试、示例和文档，并按此版本调整 peer dependencies 与 API 类型。保留策略注册校验、有界并发的有序阶段执行、作者偏好变体、通过原版 jobs 显示进度，以及独立 Cordis 入口。以当前上游 subagent 实现为基础，只重新应用任务策略所需的最小可选 preset 选择扩展。

迁移前盘点当前 DSH 插件。兼容时保留插件包身份/版本、依赖、组合包顺序和用户编写的 profile patch。不要复制生成的 `node_modules`、缓存、运行时二进制文件或过期 lockfile。遇到不兼容或缺失插件时要明确报告，不要静默丢弃、升级或禁用。构建期间将现有 profile 视为只读并作为回滚来源；为候选 Desktop 单独暂存迁移后的 profile。

## Desktop 接入与显式启用

将策略包及其 workspace 依赖闭包加入 Desktop 产出的本地包集合，使安装后的 Desktop 无需依赖 registry 即可解析。保留官方包集合的完整性校验和 lockfile 保证。Desktop 项目元数据可以包含该包作为依赖；但 Desktop profile 的有序 bundles 列表和 Cordis patch 仍是明确的启用开关。

候选 profile 必须包含策略 carrier 的 opt-in patch 条目和作者提供的策略配置。除非依赖/API 兼容性要求并有说明，否则既有插件组合包维持原有顺序。编译候选版本时，不得顺带修改用户当前 Desktop profile 或全局 DSH home。

## 构建与验收

按官方 Desktop 打包流程生成未签名的 Windows x64 包；用户未提供签名证书。产物必须标明上游预发布版本和迁入的策略修订。包输出与构建缓存保存在隔离 worktree 的 Desktop 忽略目录中。

交付前，针对策略库/carrier 和 subagent 集成执行聚焦检查，然后运行官方 Windows x64 打包流程。在隔离 profile 中启动产物，并确认 Desktop Host 与前端可以运行；启用时策略服务可发现；策略可通过原版 DSH jobs 创建并执行有序计划；进度可见；迁入且兼容的插件能够加载。交付说明应记录失败检查和插件兼容例外，不能把未经验证的构建说成完成。

## 切换与安全措施

迁移期间保持用户现有 checkout、分支、应用安装和 DSH home 不变。在精确的上游标签之上使用独立分支工作。候选包和隔离 profile 供用户评估；只有用户确认可用后，才切换未来开发基线或日常使用安装。保留旧源码引用和 profile 以便回滚。

除非用户另行要求，本次迁移不推送任一镜像、不创建发布，也不替换已安装应用。如果最新上游 API 与保持 DSH 生命周期语义的策略行为不兼容，应在该边界暂停并说明具体冲突，交由用户决定。
