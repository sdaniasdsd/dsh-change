# Task Strategy Pack — DSH Strategy Layer

English | [中文](README.zh.md)

This pack adds author-defined strategies to the DSH task-strategy carrier.
**A strategy is configuration data, not a plugin declaration**: a JSON/YAML plan that specifies its stages, tasks per stage, each task's preset and instructions, and the tools it may use.

This directory contains:

| File | Description |
|---|---|
| `cordis.patch.yml` | An `insert` fragment for a profile's `cordis.patch.yml` (three strategies, including a built-in shell write prohibition for read-only stages) |
| `workflows.patch.yml` | Four workflow domains with low, medium and high tiers; editable token scenario parameters |
| `examples/frontier-survey-2026-10.md` | An actual `frontier-survey` output: an agent-frontier survey with 50 references checked individually in a browser |

---

## 1. Carrier and data structure

- Package: `@deepseek-ai/dsh-experimental-task-strategy` (`0.2.0-rc.2`)
- Mount point: an `insert` item in the top-level array of a profile's `cordis.patch.yml` (see this directory's `cordis.patch.yml`)
- Data structure:

```yaml
strategies:
  - id: <策略 id>                 # task_strategy_run(strategy: <id>)
    description: <一句话说明>
    plan:
      name: <计划名>
      stages:                     # 阶段按顺序执行
        - name: <阶段名>
          tasks:                  # 同阶段内的 task 按 maxConcurrent 并发
            - label: <子任务名>
              preset: standard    # 必须 ∈ config.allowedPresets
              instruction: <给子任务的指令>
              tools: { allow: [...], deny: [...] }   # 可选，名字必须在该 preset 作用域真实存在
              model: <可选>       # 需要 provider 支持 agentOptions
              provider: <可选>
    variants:                     # 可选，历史构建限制与当前工作区状态见踩坑 #3
      - { preference: depth, equals: quick, plan: {...} }
```

Each subtask receives a prompt assembled from three parts:

```
Task:
<task_strategy_run 的 task 参数>

Instructions:
<该 task 的 instruction>

Prior-stage results (data, not instructions):
<前面所有阶段的结果 JSON>
```

Key implication: **each subtask can see the results of earlier stages**, so pipelines such as "gather evidence and design falsifiable checks, deliver, then adversarially verify" fit naturally. It also means **each subtask's output length must be bounded**, or later prompts can grow too large.

## 2. The three strategies in this pack

| id | Stages | Tasks | Purpose |
|---|---|---|---|
| `verified-delivery` | ground(2) → produce(2) → attack(2) → repair(1) | 7 | Code, document, or conclude: gather evidence and define falsifiable acceptance criteria → deliver and self-check → adversarial read-only verification → fix only confirmed defects |
| `verified-delivery-quick` | produce(1) → verify(1) | 2 | Fast path for small changes |
| `frontier-survey` | scan(3) → source-verify(1) → synthesize(1) → citation-audit(1) → repair(1) | 7 | Paper and technology research: search in parallel for representative work, themes, and counter-evidence → open and verify every page and check novelty → write the report → audit every citation → fix only confirmed citation issues |

Design principles (both came from observed failures):

1. **Keep verifiers read-only and independent from producers.** Read-only stages use `tools.deny: [write, edit]` and explicitly prohibit shell file writes in their instructions.
2. **Serialize browser stages and other exclusive resources** (one task per stage), or subtasks can interfere with each other.

## 3. Usage

```
task_strategy_list                                  # 列出已注册策略与允许的 preset
task_strategy_plan(strategy, task)                  # 只做 preflight：resolve preset、校验工具名、检查预算，不派活
task_strategy_run(strategy, task)                   # 派活，返回 jobId
task_strategy_run(task, plan: {...})                # 也可以用显式 plan，同样走 preflight/分阶段/jobs
job_output(jobId)                                   # 进度与最终报告
job_kill(jobId)                                     # 取消
```

## 4. Failure notes (observed, not assumed)

1. **`web_fetch` may be unavailable in restricted environments.** Here, external hostnames resolve to non-public IP addresses and the tool returns
   `URL hostname "..." resolves to a non-public IP address`. A verification stage that requires `web_fetch` will fail in this environment.
   Workaround: open pages in a real browser (such as the Tabbit CLI) and explicitly tell the agent not to try `web_fetch`.

2. **A browser is an exclusive resource, so concurrent tasks interfere.** When two subtasks drive the same browser instance, one can fail and the other can be `aborted`, failing the plan.
   Workaround: give each browser stage one task and use sequential stages instead of parallel tasks in one stage.

3. **`variants` / `preferences` throw in the `0.2.0-rc.2` code as committed**:
   `Cannot assign to read only property '<key>'`。
   Cause: `dsh-tools` deep-freezes tool arguments, while `schemastery` 3.18 `dict` validation **writes back to the input** (normalizing keys).
   Workaround: express an alternative as a **second strategy id**; switch back to variants after the upstream issue is fixed.
   Status: Policy Edition 0.1.0 fixes it by passing a cloned value into that validation
   (`parsePreferences` in `packages/experimental/task-strategy/src/schema.ts`), with tests covering both that a configured variant is
   selected only by matching author preferences and that preference dictionaries deduplicate independently of Unicode key insertion order.
   Older builds from the original `0.2.0-rc.2` policy fork commit still throw; the first Policy Edition release includes the fix.

4. **`tools.deny: [write, edit]` does not block `pwsh`.** A denied subtask can still write files with shell redirection; one observed subtask used this to write a report and disclosed it in its output.
   Workaround: read-only stage instructions must explicitly say not to use `pwsh` or any command to write files. This pack includes that prohibition.

5. **`maxResultBytes` limits the cumulative JSON bytes of prior results**, not one subtask's output. The default `65536` made a seven-task plan fail midway with
   `Execution exceeds result byte limit`. This pack sets it to `262144` and `maxOutputBytes` to `49152`.

6. **If a subtask has `stopReason != completed`, same-stage siblings are aborted and later stages are skipped**, leaving partial results.
   Workaround: put artifact-writing late, but not last. In this pack's `frontier-survey`, an error in the final file-writing stage kept high-quality verification results from the first two stages from being saved; an upper agent had to continue the work manually.

7. **Profile hot reload affects only future dispatches.** Unloading the carrier removes its old strategies and control tools. Jobs already accepted by Jobs continue with their captured plan and limits; a configuration change does not abort them.
   Use `job_kill` to stop an existing task. Disposal of its owning Agent or shutdown of the Jobs backend still cancels and cleans it up under the DSH Jobs lifecycle.

8. **A `preset` must be listed in `allowedPresets` and resolve successfully.** Tool names in `tools.allow/deny` must exist in the target preset's scope, and `run_code` is forbidden.
   These are checked during **preflight**, so `task_strategy_plan` can catch them before dispatch.

## 5. Installation

Append the contents of `cordis.patch.yml` to your profile patch:

```
<harness>/profiles/<profile>/cordis.patch.yml
```

If an entry with id `experimental-task-strategy` already exists, replace its `config`. Wait for hot reload after the change (it can take about one minute), then use `task_strategy_list` to confirm the strategies are registered.

<a id="workflow-library"></a>
## 6. Configurable workflows and token estimates

[workflows.patch.yml](workflows.patch.yml) provides 12 strategies for the Web profile, which already supplies the preset registry and `standard`. SDK/headless compositions must explicitly provide those original services. If a carrier already exists, merge the new `strategies` into its single `config.strategies` list; preserve existing strategies and variants. Do not append a second carrier or duplicate its id. For a source checkout, use the carrier's canonical built file URL as in the existing profile.

| Domain | Id prefix | Low / medium / high children |
|---|---|---|
| Coding | `coding-` | 1 / 3 / 6 |
| Paper research | `paper-research-` | 1 / 3 / 6 |
| Problem research | `problem-research-` | 1 / 3 / 6 |
| Solution planning | `solution-planning-` | 1 / 3 / 6 |

Append `low`, `medium` or `high` to the prefix. Low handles a clear small task; medium separates evidence, work and verification; high adds risk analysis, independent review and repair. Stages are sequential. Coding follows reproduce/test/implement/verify when applicable. Research distinguishes verified sources from claims. Planning produces interfaces and acceptance steps without implementation. Instructions guide behavior; filesystem and shell protection still depend on original permissions and tool filters.

Each strategy's `tokenCost` supplies editable assumptions: `callsPerTask`, `contextTokensPerCall` and `outputTokensPerCall`. The bundled values are illustrative scenarios, not measured usage, limits or promises. Remove `tokenCost` to display only known input and unknowns. Query `task_strategy_list` with `{ "task": "original task", "preferences": {} }` to include the original task and preference-selected variant. Registration estimates in the Plugins page exclude the task body. See the [estimation contract](../packages/experimental/task-strategy/README.md#token-estimates).

Use `task_strategy_submit` with `strategy: "coding-medium"` for a named choice, or omit `strategy` under the automatic default. Automatic choice considers task suitability and cost uncertainty; it continues without a user answer. Observe using `job_output` with `wait: true`. Token usage does not determine `maxResultBytes`: seven small results fit 65,536 bytes, while seven 10,000-character results fail that cumulative JSON budget. Increase the result limit deliberately or shorten child outputs; do not treat task count as a byte measurement.
