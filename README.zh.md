# DeepSeek Harness — 策略增强版

[English](README.md) | 中文

本仓库是独立维护的 DeepSeek Harness 实验性 fork，不是 DeepSeek 官方发行版。它在原版 DSH 执行层上增加了由作者控制的任务策略层。源码镜像：[GitHub](https://github.com/sdaniasdsd/dsh-change) 和 [Gitee](https://gitee.com/chunyouzhidi/dsh-policy-version)。

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

上游文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 策略增强版：我们的改动

### Policy Edition 0.1.0 安装包

从 [GitHub Releases](https://github.com/sdaniasdsd/dsh-change/releases) 下载 Windows x64 预览版安装包。
该独立构建未签名，沿用上游运行时版本 `0.2.0-rc.2`。
内置策略插件 UI、可选 LLM 选择、阶段边界控制、可解释 Token 估算，以及十二个可配置工作流：
编程、论文调研、问题研究、方案规划，每类都有低、中、高三档。
估算描述子任务执行场景，不是账单或 Token 硬上限。安装后需自行配置供应商和模型。
默认数据目录为 `~/.dsh-policy`；显式 `DSH_HOME` 仍优先。
该版不接入官方自动更新源或强制更新服务。后续策略版通过下载安装包手动升级。

复现未签名构建时，创建被 Git 忽略的 `apps/desktop/.env.windows`：

```dotenv
DSH_DESKTOP_EDITION=policy
DSH_DESKTOP_APP_ID=io.github.sdaniasdsd.dshchange
```

然后运行 `corepack pnpm run package:desktop:win:x64:unsigned`。新建 Desktop 配置时将策略库激活为 bundle；
后续在插件页进行的修改持久化到用户配置补丁。
已有配置保持原样。安装包不包含 API 密钥或用户会话。

上层决定分发哪些任务、按什么顺序执行、使用什么能力；实际工作由原版 DSH subagent 完成。作者自行定义决策偏好，不替换模型循环，也不把每个策略混入 DSH 插件体系。

- **独立策略部件：**具名策略接收任务与作者偏好，产出执行计划。作者可以编写 JavaScript 决策函数，也可以在配置中按偏好选择不同流程。
- **任务流程与并发：**计划由有序阶段组成。同一阶段的任务可以在配置的单次运行并发上限内同时执行；前一阶段结束后，后一阶段接收已有结果。
- **下层能力选择：**每个任务选择允许使用的原版 DSH preset，由 preset 提供插件组合，并可限制工具或选择模型与提供商。选择 preset 不会额外授予文件系统或审批权限。
- **沿用原版 DSH 执行：**可选的 Cordis 接入部件把独立策略部件连接到现有 subagent、preset 和 Job。下层任务仍由原版 agent loop 执行并负责资源清理。
- **进度观察与取消：**上层 agent 通过 `task_strategy_list`、`task_strategy_plan`、`task_strategy_run` 发现、预览和分发计划。现有 `job_list`、`job_output`、`job_kill` 提供进度、已完成任务的子会话标识、结果和取消操作。

策略层需要显式启用：不加载补丁的 profile 保留原版组合。示例配置提供 `direct` 和 `cautious`；后者先并行进行两项只读检查，再执行实现任务，而 `speed=fast` 偏好会选择更短的流程。

这个原型不是持久化工作流引擎：没有全局并发配额、自动重试、暂停/恢复或崩溃恢复。下层任务共享工作文件，并发写入需要作者安排安全流程。真实模型执行需要配置模型提供商；附带集成测试使用无密钥的脚本化模型适配器，不是真实模型质量评分。

建议从这里开始阅读：

- [策略用法、源码结构与限制](packages/experimental/task-strategy/README.zh.md)
- [作者偏好与任务流程示例](packages/experimental/task-strategy/cordis.source.patch.yml)
- [策略子系统与 API 参考](docs/subsystems/task-strategy.zh.md)

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

这条命令运行上游 npm 发行版，不包含本 fork 的策略增强。安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/sdaniasdsd/dsh-change.git dsh-policy-version
cd dsh-policy-version
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

上面的命令不会加载策略层。如需启用，请按[策略部件的源码试用说明](packages/experimental/task-strategy/README.zh.md#use-this-package)加载附带的源码补丁；启动命令和配置细节以该节为准。[Gitee 镜像](https://gitee.com/chunyouzhidi/dsh-policy-version)包含相同的增强版源码。

## 社区与支持

- 策略增强版的问题请提交到[本 fork 的问题追踪器](https://github.com/sdaniasdsd/dsh-change/issues)；上游反馈请提交到 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群！扫描下方二维码填写入群问卷，小助手会定期发送入群邀请。

<table>
  <thead>
    <tr>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
