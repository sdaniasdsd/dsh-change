# Agent 前沿技术调研（2026-10）

面向：开源 agent 工具链技术负责人。
时间窗：2025-09 ~ 2026-10-05（窗口外的经典工作标注为「背景」）。
方法：本报告的检索与核验由策略层 `frontier-survey` 的 7 个子任务分工完成；**核验阶段真的用浏览器逐条打开页面**核对标题与提交时间（本环境 `web_fetch` 因 DNS 拦截不可用，核验一律走 Tabbit 浏览器渲染）。正文只使用核验判为 VERIFIED 的条目；未核验、编号错配、结论冲突项一律进 §6，不进结论。

---

## 0 摘要

前沿重心已从「让模型多想几步」转向四件事：**长程交互的信用分配**、**harness 与工具链本身成为一等研究对象**、**权限/不可信内容的能力边界**、**评测可信度**。多智能体不是默认增益；记忆榜单与 SWE 系榜单都不足以单独支撑选型。最值得警惕的是：2026 年两个连续的前沿编码基准（SWE-bench Verified、SWE-bench Pro）分别被官方停报和第三方评为 Flawed，而 harness 差异能解释相当一部分分数差距。工程上未来一年的高杠杆投入是：可审计 harness、可重放执行、权限边界、成本与可靠性维度评测——而不是增加 agent 数量。

---

## 1 前沿在做什么：8 个方向

### 1.1 长程 agent RL：信用分配 + 环境/harness 供给（新问题为主）
- **在解决什么问题**：单条 rollout 跨数百次交互、近 1M token 时，outcome reward 无法定位"第 47 步错了"；训练环境能否回放、训练 harness 与生产 harness 是否同构，直接决定收益能否迁移。
- **为什么是现在**：可重置的高保真环境（终端、浏览器、代码仓库）+ 弹性 rollout 基础设施 + 分层奖励分解同时到位。
- **代表工作**：[1] 把树搜索搬进 agent RL 回路；[2] 主张"任意 harness 上做规模化 agentic RL"；[3] 用弹性资源调度支撑 xLong-horizon 训练；[4] 用 step-level 经验与训练时信息做信用分配。原列于此的"可行失败前缀构造密集信号"（`2609.37111`）因未完成核验，已移入 §6，不作为本方向依据。
- **争点**：训练期 harness 与用户手里的 harness 不同，收益还剩多少？把搜索树塞进 RL 是提升探索，还是把推理期算力重新贴标签成"训练"？

### 1.2 Test-time compute 与自验证（被高估的方向之一）
- **在解决什么问题**：固定预算下，"多采样 + 验证器"与"训更强策略"各自值多少；而 agent 的验证器与 actor 常同源同错。
- **为什么是现在**：agent 任务自带弱验证信号（测试通过、工具返回），让测试时搜索第一次可度量。
- **代表工作**：[6] 反思式提示演化路线；[7] 长程反思任务上的自改进；[8] 零数据自博弈（背景）。
- **争点**：跨域统一计费后测试时扩展的收益显著缩水——把选择成本计入预算，很多"免费提升"不成立。**不要把 test-time compute 当免费能力。**

### 1.3 记忆：从"造系统"转向"证伪评测"（新问题）
- **在解决什么问题**：记忆的真实增量是多少、是否已被长上下文吃掉；记忆是外部检索系统、可训练策略组件，还是可回放执行轨迹。
- **为什么是现在**：长程任务暴露了上下文膨胀与历史压缩的可测代价。
- **代表工作**：[9] 系统剖析记忆评测与系统局限（基准 underscaled、指标与语义效用错位、跨 backbone 方差大、系统成本被忽略）；[10] 索引化可检索经验记忆；[11] 执行级可回放记忆（GUI）。
- **争点**：已发表的记忆排行榜能否迁移到真实场景——在"预算化上下文恢复"设定下被直接质疑。**但没有任何一手证据表明主流记忆产品第三方复现失败**，不要把评测批评夸大成"记忆无用"。

### 1.4 多智能体：收益递减 + 隐藏状态失败（证据首次足以推翻默认架构）
- **在解决什么问题**：什么条件下拆分/并行/互审能抵消协调开销。
- **为什么是现在**：单体基线足够强，使"多 agent 增益"第一次能被严格对照。
- **代表工作**：[12] 固定 prompt/工具/算力预算、260 组配置 × 6 基准 × 5 架构的横评，发现**存在能力饱和阈值**，模型越强协作收益越小甚至转负；[13] 多 agent 之间无法有效互相探索，交互短视且极化；[14] "答案对但内部信息状态已被污染"；[15] MAS 失败模式分类学（NeurIPS 2025 D&B spotlight）。
- **争点**：横评用通用基准，而 MAS 的真实价值可能在权限分离/异构工具而非投票——但"默认上多 agent"已无依据。

### 1.5 Harness 与上下文工程成为一等研究对象（新问题，最实用）
- **在解决什么问题**：不是"塞什么进上下文"，而是"谁在什么权限下看到什么"；以及**harness 本身解释了多少分数**。
- **为什么是现在**：同一模型换 harness 结果差异巨大，而多数论文不披露 harness，导致横向比较失去意义。
- **代表工作**：[16] 不披露 harness 就别比较 agent（立场论文）；[17] 拆解 SE agent 的 harness 效应；[18] 推理期多 agent 并行 + 工具混合（背景）。
- **争点**：提高基准难度（Pro 路线，自身已被评 Flawed）vs 报 harness + 报分布（证据更强、成本更低）。

### 1.6 权限、工具安全与不可信内容：从"过滤注入"转向"能力授予"（新问题）
- **在解决什么问题**：agent 能做什么必须由架构保证，不能靠提示词保证；外部内容诱导越权如何从机制上阻断。
- **为什么是现在**：MCP/技能生态把工具面变成攻击面，事故可归因。
- **代表工作**：[19] MCP 安全威胁综述（背景）；[21] 来源感知的检索净化——**合成基准上最强的改写防御在真实企业文档上无显著攻击成功率下降**；[22] 为 web agent 的不可信内容屏蔽提供安全保证；[23] 递归 agent 树的权限渐进授予（理论与合成实验）。
- **争点**：capability-based（限制能做什么）与 taint-based（限制能看到什么）如何组合且不掉成功率。

### 1.7 评测危机：榜单失去排序能力（新问题）
- **在解决什么问题**：当头部分数挤在一起、测试本身有缺陷，评测还能否区分系统。
- **为什么是现在**：头部编码 agent 分数收敛，饱和从预测变成可观测事实。
- **代表工作**：[24] 论证 SWE-bench 头部已无法排序（top-10 共享 285 个成功，仅 164 题能区分名次，前沿解集嵌套度 0.935）；[25] 对抗式加强基准暴露"语义等价但测试不认"的虚高通过率；[26] SWE-bench Pro（编号 2509.16941，注：常被误引为 2609.16941）；[27] 基准被系统性攻击（BenchJack，仅经官方博客核验）。
- **争点**：加难 vs 换测量维度（可靠性、成本、重试预算、置信区间）。

### 1.8 应用侧：编码 agent 是唯一有现实部署证据的方向
- **在解决什么问题**：分数与生产力的缺口是评测问题还是系统问题；长程 GUI/科研任务的可靠边界在哪。
- **代表工作**：[28] 微软 2026 早期 Claude Code / Copilot CLI rollout 的采纳与影响研究；[29] 长程退化（"agent rot"）实证；[30] 生产 runtime 静默失败分类学；[31] 超长程重复 computer-use 基准；[32] 浏览器 agent 的真实世界长程任务；[33] 四次自主科研尝试复盘（三次失败）；[34] 终端编码 agent 长程 RL。
- **争点**：CLI agent 的收益有多大比例来自 harness 而非模型——我倾向"一半以上来自 harness"。

---

## 2 代表性论文 Top 10

| # | 题目 | 机构 | 时间 | 来源 | 一句话贡献 | 链接 | 核验 |
|---|---|---|---|---|---|---|---|
| 1 | Tree Search for LLM Agent Reinforcement Learning | 页面未明示 | 2025-09 | arXiv（自述 ICLR 2026） | 把树搜索搬进 agent RL 回路，代码 Tree-GRPO | [2509.21240](https://arxiv.org/abs/2509.21240) | VERIFIED |
| 2 | Polar: Agentic RL on Any Harness at Scale | NVIDIA 系作者 | 2026-05 | arXiv | 在任意 harness 上做规模化 agentic RL，工具链团队最直接的基础设施信号 | [2605.24220](https://arxiv.org/abs/2605.24220) | VERIFIED |
| 3 | QwenGyre: An Elastic Reinforcement Learning Framework for Training xLong-Horizon Agents | 页面未明示 | 2026-09 | arXiv | 单 rollout 近 1M token / 数百次交互的弹性 RL 框架 | [2609.33848](https://arxiv.org/abs/2609.33848) | VERIFIED |
| 4 | Anatomy of Agentic Memory: Taxonomy and Empirical Analysis of Evaluation and System Limitations | 页面未明示 | 2026-02 | arXiv | 记忆赛道少见的降温型实证：评测不可比、成本被忽略 | [2602.19320](https://arxiv.org/abs/2602.19320) | VERIFIED |
| 5 | Beyond the Model: Demystifying Harness Effects in Software Engineering Agents | 页面未明示 | 2026-09 | arXiv | 把"harness 解释了多少分数"从经验之谈变成可测问题 | [2609.32459](https://arxiv.org/abs/2609.32459) | VERIFIED |
| 6 | CCTU: A Benchmark for Tool Use under Complex Constraints | 页面未明示 | 2026-03 | arXiv（AACL 2026） | 复杂约束下的工具使用基准，直击"能调用"≠"会遵守约束" | [2603.15309](https://arxiv.org/abs/2603.15309) | VERIFIED |
| 7 | Coding Agents Have Converged: Why the SWE-bench Leaderboard Can No Longer Order Its Top Entries, and What to Measure Instead | Fengshuo Liu 等 | 2026-09 | arXiv（ADMA 2026） | 用解集嵌套度证明头部榜单已无排序能力 | [2609.17394](https://arxiv.org/abs/2609.17394) | VERIFIED |
| 8 | Why Do Multi-Agent LLM Systems Fail? | UC Berkeley 等 | 2025-03 | NeurIPS 2025 D&B（spotlight） | 1600+ 轨迹归纳 5 类 14 种 MAS 失败模式 | [2503.13657](https://arxiv.org/abs/2503.13657) | VERIFIED（背景） |
| 9 | Capable language models can outgrow the benefits of collaboration | Google Research、MIT 等（页面 affiliation） | 2026-07 | Nature Machine Intelligence 8:1157–1172 | 受控横评：单 agent 基线是"协作是否有益"的最强预测因子 | [Nature](https://www.nature.com/articles/s42256-026-01268-y) | VERIFIED |
| 10 | Untrusted Content Masking for Web Agents with Security Guarantees | Tramèr 组 | 2026-07 | arXiv | 对不可信内容做有安全保证的屏蔽，而非启发式过滤 | [2607.05277](https://arxiv.org/abs/2607.05277) | VERIFIED |

**按需加读**：`2609.01035` Spawn Freely, Act Sparingly（递归 agent 树的权限渐进授予，理论+合成，无部署评估）；`2601.03315` Why LLMs Aren't Scientists Yet（自主科研的诚实负面复盘）；`2608.17319` Wuying-Browser-Agent（真实世界长程浏览器 agent）；`2510.24701` Tongyi DeepResearch Technical Report（可复现开源深度研究栈）；`2607.01418` 微软 CLI agent rollout 研究。

---

## 3 最具创新性的 3 篇

> "创新性"= 对工具链决策的信息增量，不代表已被广泛证明有效。

### 1. [Right Answers, Wrong States: Hidden Information Failures in Multi-Agent Collaboration](https://arxiv.org/abs/2610.01244)（2026-10）— 新评测视角
**创新点**：盯的是"最终答案对、但内部信息状态已被污染"这一**无法从答案观测的失败面**。
**与最近邻的差别**：[MAST](https://arxiv.org/abs/2503.13657)（2025-03）看的是最终结果与协作动态；[Multi-Agent LLMs Fail to Explore Each Other](https://arxiv.org/abs/2607.11250)（2026-07）看的是交互短视与极化。二者都无法暴露"状态污染"。
**时间先后**：2026-10，是本次核验材料中窗口内最新的工作之一。

### 2. [Spawn Freely, Act Sparingly: Progressive Risk Vesting for Recursive LLM-Agent Trees](https://arxiv.org/abs/2609.01035)（2026-09）— 新问题（成熟度低）
**创新点**：把"生成子 agent"的权限与"授予行动权"解耦，按风险渐进 vesting。
**与最近邻的差别**：[Progent](https://arxiv.org/abs/2504.11703)（2025-04）已有最小权限/特权控制，但是系统实现而非权限传播模型；未找到更早的"子 agent 树权限传播"先例。
**诚实标注**：单作者、8 页，comment 明示"理论 + 合成数值研究，无部署 agent 评估"。属**问题提出**，不是可用方案。

### 3. [GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457)（2025-07，ICLR 2026 Oral）— 新机制（沿旧线）
**创新点**：用执行轨迹做自然语言反思 + Pareto 前沿选择来进化提示词，并声称在部分任务上超过 GRPO 类 RL。
**与最近邻的差别**：[Self-Refine](https://arxiv.org/abs/2303.17651)（2023-03）、[Reflexion](https://arxiv.org/abs/2303.11366)（2023-03）、[Chain-of-Verification](https://arxiv.org/abs/2309.11495)（2023-09）都在**推理期**自评自改；GEPA 把反思搬到**提示词搜索**上。
**时间先后**：晚于上述三篇；venue 经 OpenReview 实测为 ICLR 2026 Oral（RQm2KQTM5r）。
**争点**：与 RL 的比较是否在等算力预算下完成——这条不解决，"反思超过 RL"就不能当结论。

**候补**：[PARSE](https://arxiv.org/abs/2606.17467)（2026-06，合成基准上最强的注入防御在真实企业文档上失效）；[SWE-ABS](https://arxiv.org/abs/2603.00520)（2026-02，把"语义等价但测试不认"的假阳性系统化，且早于 Epoch 的独立审计——两者独立同向才可信）。

---

## 4 争议与反证

### 4.1 榜单已经不能排序，而"换个新基准"也没解决问题
- **OpenAI 官方于 2026-02-23 停止报告 SWE-bench Verified**：27.6% 长期未解题中 ≥59.4% 存在测试设计缺陷（会拒绝正确解），且所有前沿模型都能复现金标准补丁。[官方说明](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)
- **Epoch AI 于 2026-09-01 将 SWE-bench Pro 评为 "Flawed"**：原文称 "30% or more of tasks are broken"，审计链为 2026-02-24 Gabor（100 题中 83 题有问题）、2026-05-26 Datacurve（24% 假阴性 / 8.5% 假阳性）、2026-07-08 OpenAI（约 30% 损坏）。[Epoch AI review](https://epoch.ai/benchmarks/swe-bench-pro/review)
- **结论**：Verified 停了、Pro 也被判定有缺陷，说明这不是"某代基准的污染问题"，而是**测试型基准的范式问题**。

### 4.2 多智能体不是默认更强（本次最强反证）
[Nature MI](https://www.nature.com/articles/s42256-026-01268-y)（2026-07-24）：固定提示词/工具/算力预算，260 组配置 × 6 基准 × 5 架构 × 3 模型族，**单 agent 基线成绩是协作是否有益的最强预测因子**，且存在能力饱和阈值——超过阈值后增加 agent 不再提升。辅证：[2607.11250](https://arxiv.org/abs/2607.11250)（agent 之间无法互相探索）、[MAST](https://arxiv.org/abs/2503.13657)（失败是结构性的）。

### 4.3 分数涨 ≠ 可靠性与生产可用性涨
- 普林斯顿团队（Rabanser, Kapoor, Narayanan 等）：把 agent 行为压成单一成功率掩盖了鲁棒性、可预测性、安全性与成本维度。[2602.16666](https://arxiv.org/abs/2602.16666)（2026-02）
- 生产 runtime 的静默失败已有纵向分类学：[2606.14589](https://arxiv.org/abs/2606.14589)（2026-06）；长程退化"agent rot"有实证：[2609.01660](https://arxiv.org/abs/2609.01660)（2026-08）。
- 生产运行实测：[2609.21341](https://arxiv.org/abs/2609.21341)（2026-09）报告 8,199 次运行、110,711 条 ledger 事件、14,008 次工具调用被拒；2,100 次模型归因损失中 1,590 次（**75.7%**）发生在**已成功调用过工具**的运行里 → 主要瓶颈在工具链路与 harness，而非模型知识。**该数字在核验阶段经全文 HTML 复核确认存在**（早前"查无此数据"的说法系只看摘要所致，已纠正）。

### 4.4 成本是被忽略的一等维度
- 测试时扩展跨域统一计费后收益显著缩水：[2610.01110](https://arxiv.org/abs/2610.01110)（2026-10）。
- 安全 agent 评测只报宽松预算下的峰值能力，按固定成本比较后排序改变：[2607.15263](https://arxiv.org/abs/2607.15263)（2026-07）。
- agentic coding 的 token 消耗分布可测且高度不均衡、事前难预测（[Stanford Digital Economy Lab](https://digitaleconomy.stanford.edu/publication/how-do-ai-agents-spend-your-money-analyzing-and-predicting-token-consumption-in-agentic-coding-tasks/)，2026-04）。

### 4.5 记忆证据仍不够稳
[2602.19320](https://arxiv.org/abs/2602.19320) 批评评测；[2607.16848](https://arxiv.org/abs/2607.16848)（2026-07）在"预算化上下文恢复"设定下发现排行榜不可迁移；[2610.02764](https://arxiv.org/abs/2610.02764)（2026-10）用置换审计指出个人记忆的"个性化增益"部分来自用户评分倾向而非历史关联。
**注意**：核验阶段**未找到**任何主流记忆系统（Mem0/A-MEM 等）第三方复现失败的一手报告——不要把"评测不可靠"写成"记忆无效"。

### 4.6 自我改进与安全：两个方向性的坏消息
- **污染信任根**：对自我改进编码 agent 的自评基准投毒，可让后续版本在干净留出任务上写入漏洞代码（"Reflections on Trusting Trust" 的 agent 版）：[2609.17817](https://arxiv.org/abs/2609.17817)（2026-09）。
- **安全能力不随之泛化**：执行能力可泛化到未见任务，而安全能力常常不泛化，且不是单纯数据不足：[2605.06992](https://arxiv.org/abs/2605.06992)（2026-05，v2 2026-09）。

### 4.7 明确点名的营销叙事
- **"95% 的 AI agent 部署失败"**：定向检索只能追到厂商内容营销页（同一页正文还自相矛盾地写 70%），**无可核验一手研究**。不要引用任何"X% agent 部署失败"数字。
- **"OSWorld 2.0"**：未找到官方论文或主页，只见第三方榜单页与引用它的论文；`OS-Marathon`（[2601.20650](https://arxiv.org/abs/2601.20650)）是另一条真实基准线，勿混用。

---

## 5 未解决问题与未来 12 个月判断

1. **长程训练如何与生产 harness 对齐？** 需要公开环境状态、工具契约、重试策略与失败轨迹；只报训练成功率不足以说明可迁移。
2. **如何做等预算的 agent 比较？** 把模型调用、验证、工具执行、重试、延迟、人工介入全部计入，并在成功率之外报告成本与可靠性分布。
3. **记忆的增量价值如何识别？** 在同模型、同 token/延迟预算下与长上下文/检索/轨迹回放对照，看语义正确性而非仅命中率。
4. **权限能否成为工具协议的一等属性？** 最小权限、来源溯源、不可信内容隔离、审计日志的组合式设计，且必须用真实工具链的攻击与误拒成本来评估。
5. **多智能体在什么条件下值得？** 预计从"通用增益"收敛到有明确分工、异构权限/工具、并行收益可度量的窄场景。

**我的判断（12 个月）**：
- 评测会从"更高更难"转向"披露 harness + 报分布 + 报成本"，因为前者已被证明无法解决排序问题。
- 工程投入回报最高的是 harness 与执行可重放性、权限边界、失败分类学（静默失败/退化），而不是增加 agent 数量或堆 test-time compute。
- 编码 agent 仍是最有现实部署证据的方向；computer use 正转向长程与重复任务；科研 agent 的端到端主张仍应维持审慎。
- 自我改进闭环在没有可信验证器与信任根保护前，工程上不宜作为默认路线。

---

## 6 未核验与局限

**方法与限制**
- 检索阶段用 `web_search`（本环境可用）；**核验阶段用 Tabbit 浏览器渲染页面**逐条核对标题/提交时间/venue。`web_fetch` 在本环境**完全不可用**（DNS 拦截，报 `URL hostname ... resolves to a non-public IP address`），任何声称用 HTTP 抓取完成的"核验"都不成立。
- arXiv 官方 API 在本轮大面积返回 429（限流），故以 abs 页直读为主；正文数字另取全文 HTML 复核。
- 时间一律取首版提交月或页面署日；会议录用时间与预印本时间可能不同（已在条目中区分"页面未明示"与实测 venue）。
- 机构字段只在页面实测给出时填写，其余标"页面未明示"，不做推断。

**未通过核验 / 冲突 / 剔除项**
- **KLong: Training LLM Agent for Extremely Long-horizon Tasks（2602.17547）**：comment 原文为作者请求撤稿（"significant errors were discovered in the data…affect the validity of the results"），**不作正面证据引用**。
- **SWE-Bench Pro 编号错配**：常被引作 2609.16941（该号段不存在此文），真实编号 2509.16941，且首版为 2025-09，不能当窗口内新作。
- **2609.21341 的 8,199 / 75.7%**：曾出现"无此数据"的相反说法，经全文 HTML 复核确认存在，本文采信并已写明来源；若需对外引用，建议自行复核该文 §4。
- **OSWorld 2.0**：无官方论文/主页，不作为基准引用。
- **未核验成功，故不进入结论**：**`2609.37111` Learning from Viable Failure Prefixes: Milestone Viability Potential Policy Optimization for Long-Horizon LLM Agents（2026-09-29）**——链接可达、标题已实测更正，但未完成逐字核验，原 §1.1 依据已移除；**`2605.21392` VIPER-MCP: Detecting and Exploiting Taint-Style Vulnerabilities in Model Context Protocol Servers（2026-05-20，v2 2026-08-12）**——同上，原 §1.6 依据已移除；AsyncTool、InfoMosaic-Bench、Orak、SR-Scientist、GAIA/WebArena 的确证泄漏证据（只找到攻击工具配置，不构成泄漏证明）、主流记忆系统第三方复现失败报告、CACM "Goodhart's Law Comes for Every Benchmark"（多次访问 404）。
- **仅经二手中介核验**：BenchJack（`2605.12673`）本轮只核验了 Berkeley RDI 官方博客页面（2026-04），论文本身未逐字复核。
- **证据等级偏低的已收录项**：`2609.01035`（单作者理论+合成）、`2607.14275`（单作者+自建 harness）、`2605.23950`（立场论文）。

---

## 7 参考文献

| # | 标题 | 时间 | 链接 | 核验 |
|---|---|---|---|---|
| 1 | Tree Search for LLM Agent Reinforcement Learning | 2025-09 | https://arxiv.org/abs/2509.21240 | VERIFIED |
| 2 | Polar: Agentic RL on Any Harness at Scale | 2026-05 | https://arxiv.org/abs/2605.24220 | VERIFIED |
| 3 | QwenGyre: An Elastic Reinforcement Learning Framework for Training xLong-Horizon Agents | 2026-09 | https://arxiv.org/abs/2609.33848 | VERIFIED |
| 4 | SWEET-RL: Training Multi-Turn LLM Agents on Collaborative Reasoning Tasks | 2025-03 | https://arxiv.org/abs/2503.15478 | VERIFIED |
| 5 | Learning from Viable Failure Prefixes: Milestone Viability Potential Policy Optimization for Long-Horizon LLM Agents | 2026-09 | https://arxiv.org/abs/2609.37111 | 已降级至 §6（未核验，不再作为 §0–§5 依据） |
| 6 | GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning | 2025-07（ICLR 2026 Oral） | https://arxiv.org/abs/2507.19457 | VERIFIED |
| 7 | AREX-2: Advancing Self-Improving Agents through Long-Horizon Reflective Tasks | 2026-09 | https://arxiv.org/abs/2609.38288 | VERIFIED |
| 8 | Absolute Zero: Reinforced Self-play Reasoning with Zero Data | 2025-05 | https://arxiv.org/abs/2505.03335 | VERIFIED（背景） |
| 9 | Anatomy of Agentic Memory: Taxonomy and Empirical Analysis of Evaluation and System Limitations | 2026-02 | https://arxiv.org/abs/2602.19320 | VERIFIED |
| 10 | Memex(RL): Scaling Long-Horizon LLM Agents via Indexed Experience Memory | 2026-03 | https://arxiv.org/abs/2603.04257 | VERIFIED |
| 11 | EchoPath: Execution-Level Replayable Memory for GUI Agents | 2026-09 | https://arxiv.org/abs/2609.16635 | VERIFIED |
| 12 | Capable language models can outgrow the benefits of collaboration | 2026-07 | https://www.nature.com/articles/s42256-026-01268-y | VERIFIED |
| 13 | Multi-Agent LLMs Fail to Explore Each Other | 2026-07 | https://arxiv.org/abs/2607.11250 | VERIFIED |
| 14 | Right Answers, Wrong States: Hidden Information Failures in Multi-Agent Collaboration | 2026-10 | https://arxiv.org/abs/2610.01244 | VERIFIED |
| 15 | Why Do Multi-Agent LLM Systems Fail? | 2025-03 | https://arxiv.org/abs/2503.13657 | VERIFIED（背景） |
| 16 | Stop Comparing LLM Agents Without Disclosing the Harness | 2026-05 | https://arxiv.org/abs/2605.23950 | VERIFIED（立场论文） |
| 17 | Beyond the Model: Demystifying Harness Effects in Software Engineering Agents | 2026-09 | https://arxiv.org/abs/2609.32459 | VERIFIED |
| 18 | TUMIX: Multi-Agent Test-Time Scaling with Tool-Use Mixture | 2025-10（页面未明示 venue） | https://arxiv.org/abs/2510.01279 | VERIFIED（背景） |
| 19 | Model Context Protocol (MCP): Landscape, Security Threats, and Future Research Directions | 2025-03 | https://arxiv.org/abs/2503.23278 | VERIFIED（背景） |
| 20 | VIPER-MCP: Detecting and Exploiting Taint-Style Vulnerabilities in Model Context Protocol Servers | 2026-05 | https://arxiv.org/abs/2605.21392 | 已降级至 §6（未核验，不再作为 §0–§5 依据） |
| 21 | PARSE (arXiv:2606.17467) | 2026-06 | https://arxiv.org/abs/2606.17467 | VERIFIED（EMNLP 2026 workshop） |
| 22 | Untrusted Content Masking for Web Agents with Security Guarantees | 2026-07 | https://arxiv.org/abs/2607.05277 | VERIFIED |
| 23 | Spawn Freely, Act Sparingly: Progressive Risk Vesting for Recursive LLM-Agent Trees | 2026-09 | https://arxiv.org/abs/2609.01035 | VERIFIED（理论+合成） |
| 24 | Coding Agents Have Converged: Why the SWE-bench Leaderboard Can No Longer Order Its Top Entries, and What to Measure Instead | 2026-09 | https://arxiv.org/abs/2609.17394 | VERIFIED |
| 25 | SWE-ABS: Adversarial Benchmark Strengthening Exposes Inflated Success Rates on Test-based Benchmark | 2026-02 | https://arxiv.org/abs/2603.00520 | VERIFIED |
| 26 | SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks? | 2025-09 | https://arxiv.org/abs/2509.16941 | VERIFIED |
| 27 | How We Broke Top AI Agent Benchmarks: And What Comes Next（指向 BenchJack 2605.12673） | 2026-04 | https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/ | VERIFIED（仅博客页） |
| 28 | Adoption and Impact of Command-Line AI Coding Agents: A Study of Microsoft's Early 2026 Rollout of Claude Code and GitHub Copilot CLI | 2026-07 | https://arxiv.org/abs/2607.01418 | VERIFIED |
| 29 | How Fast Do Agents Rot? An Empirical Study of Long-Horizon Degradation in LLM Agents for Production Decision-Making | 2026-08 | https://arxiv.org/abs/2609.01660 | VERIFIED |
| 30 | When Errors Become Narratives: A Longitudinal Taxonomy of Silent Failures in a Production LLM Agent Runtime | 2026-06 | https://arxiv.org/abs/2606.14589 | VERIFIED |
| 31 | OS-Marathon: Benchmarking Computer-Use Agents on Vast-Horizon, Repetitive Tasks | 2026-01 | https://arxiv.org/abs/2601.20650 | VERIFIED |
| 32 | Wuying-Browser-Agent: Real-World Centric Fundamental Long-Horizon Browser Agents | 2026-08 | https://arxiv.org/abs/2608.17319 | VERIFIED |
| 33 | Why LLMs Aren't Scientists Yet: Lessons from Four Autonomous Research Attempts | 2026-01 | https://arxiv.org/abs/2601.03315 | VERIFIED |
| 34 | T1: Terminal Agent Reinforcement Learning for Long-Horizon Tasks | 2026-09 | https://arxiv.org/abs/2609.11042 | VERIFIED |
| 35 | Tongyi DeepResearch Technical Report | 2025-10 | https://arxiv.org/abs/2510.24701 | VERIFIED |
| 36 | Beyond Memory Leaderboards: Evaluating Scientific Memory as Budgeted Context Restoration | 2026-07 | https://arxiv.org/abs/2607.16848 | VERIFIED |
| 37 | Does SWE-Bench-Verified Test Agent Ability or Model Memory? | 2025-12 | https://arxiv.org/abs/2512.10218 | VERIFIED |
| 38 | Why SWE-bench Verified no longer measures frontier coding capabilities（OpenAI 官方） | 2026-02-23 | https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ | VERIFIED |
| 39 | SWE-Bench Pro – Benchmark review（Epoch AI，Verdict: Flawed） | 2026-09-01 | https://epoch.ai/benchmarks/swe-bench-pro/review | VERIFIED |
| 40 | What Stops a Small Language Model From Driving a Database Agent | 2026-09 | https://arxiv.org/abs/2609.21341 | VERIFIED |
| 41 | Towards a Science of AI Agent Reliability（Rabanser, Kapoor, Narayanan 等） | 2026-02 | https://arxiv.org/abs/2602.16666 | VERIFIED |
| 42 | How Much Can Language Models Gain from Test-Time Computation? | 2026-10 | https://arxiv.org/abs/2610.01110 | VERIFIED |
| 43 | Beyond Success Rate: Cost-Aware Evaluation of Offensive and Defensive Security Agents | 2026-07 | https://arxiv.org/abs/2607.15263 | VERIFIED |
| 44 | Reflections on Trusting Trust, Revisited: Contaminating Self-Modifying AI Coding Agents with Poisoned Benchmarks | 2026-09 | https://arxiv.org/abs/2609.17817 | VERIFIED |
| 45 | Why Does Agentic Safety Fail to Generalize Across Tasks?（Slutzky 等） | 2026-05 | https://arxiv.org/abs/2605.06992 | VERIFIED |
| 46 | A Controlled Audit of Personal AI Memory for Rating Prediction | 2026-10 | https://arxiv.org/abs/2610.02764 | VERIFIED |
| 47 | AI Agents Do Not Fail Alone: The Context Fails First（Bousetouane） | 2026-07 | https://arxiv.org/abs/2607.14275 | VERIFIED（单作者） |
| 48 | How Do AI Agents Spend Your Money?（Stanford Digital Economy Lab） | 2026-04 | https://digitaleconomy.stanford.edu/publication/how-do-ai-agents-spend-your-money-analyzing-and-predicting-token-consumption-in-agentic-coding-tasks/ | VERIFIED |
| 49 | Ouroboros: A Self-Developing Frontier Coding Agent with Reviewed Core Evolution | 2026-08 | https://arxiv.org/abs/2608.08311 | VERIFIED |
| 50 | A Survey of Context Engineering for Large Language Models | 2025-07 | https://arxiv.org/abs/2507.13334 | VERIFIED（背景） |

> 编号说明：本表编号与正文 `[n]` 一一对应，**为了不破坏已有交叉引用，编号保留不变**。其中 #5 与 #20 已按核验结果降级至 §6（未核验），**不再作为 §0–§5 任何结论的依据**；其标题已按页面实测回填，但核验状态不是 VERIFIED。
