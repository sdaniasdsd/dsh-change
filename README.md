# DeepSeek Harness — Policy Edition

English | [中文](README.zh.md)

This repository is an independently maintained experimental fork of DeepSeek Harness, not an official DeepSeek release. It adds an author-controlled task strategy layer above the original DSH execution layer. Source mirrors: [GitHub](https://github.com/sdaniasdsd/dsh-change) and [Gitee](https://gitee.com/chunyouzhidi/dsh-policy-version).

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Upstream documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Policy edition: our changes

### Policy Edition 0.1.0 installer

Download the Windows x64 preview installer from [GitHub Releases](https://github.com/sdaniasdsd/dsh-change/releases).
This independent build is unsigned and uses the upstream runtime version `0.2.0-rc.2`.
It includes the strategy plugin UI, optional LLM selection, stage-boundary controls, explainable token estimates,
and twelve configurable workflows: coding, paper research, problem research and solution planning, each with low, medium and high tiers.
Estimates describe child-task scenarios, not billing or a hard token limit. Configure your own provider and model after installation.
The default data directory is `~/.dsh-policy`; an explicit `DSH_HOME` still takes precedence.
It has no official automatic-update feed or mandatory-update service, and the shell disables the mandatory-update overlay. Install later fork releases manually.

To reproduce the unsigned build, create the Git-ignored `apps/desktop/.env.windows` with:

```dotenv
DSH_DESKTOP_EDITION=policy
DSH_DESKTOP_APP_ID=io.github.sdaniasdsd.dshchange
```

Then run `corepack pnpm run package:desktop:win:x64:unsigned`. The strategy library is activated as a bundle
when a new Desktop profile is created; later edits in Plugins persist in the user's profile patch.
Existing profiles are preserved. The installer contains no API keys or user sessions.

The upper layer decides which tasks to dispatch, in what order, and with which capabilities; original DSH subagents perform the work. Authors define their preferred decision rules rather than replacing the model loop or turning each policy into a DSH plugin.

- **Independent strategies:** named policies accept a task and author preferences and produce an execution plan. Authors can use JavaScript decision functions or configuration-based preference variants.
- **Task flows and concurrency:** plans contain ordered stages. Tasks in the same stage can run concurrently within the configured per-run limit; later stages receive earlier results after the preceding stage finishes.
- **Child capability selection:** each task selects an allowed original DSH preset, which supplies its plugin composition, and may restrict tools or select a model and provider. Preset selection does not grant additional filesystem or approval permissions.
- **Original DSH execution:** the optional Cordis carrier connects the independent strategy component to existing subagents, presets, and Jobs. The original agent loop still executes child tasks and owns their resource cleanup.
- **Progress and cancellation:** upper agents discover, preview, and dispatch plans through `task_strategy_list`, `task_strategy_plan`, and `task_strategy_run`. Existing `job_list`, `job_output`, and `job_kill` expose progress, completed child session identities, results, and cancellation.

The strategy layer is opt-in: launching an unpatched profile retains the original composition. The example configuration provides `direct` and `cautious`; the latter runs two read-only inspections in parallel before implementation, while a `speed=fast` preference selects a shorter flow.

This prototype supports in-process pause, resume and strategy switching at stage boundaries. It is not a durable workflow engine:
it has no global concurrency quota, automatic retries or crash recovery. Children share working files, so concurrent writes need
an author-chosen safe flow. Real model execution requires a configured model provider. Keyless integration checks and seven
live-model smoke scenarios have been exercised; these checks do not establish model quality or estimate billing accuracy.

Start reading here:

- [Strategy usage, source map, and limitations](packages/experimental/task-strategy/README.md)
- [Author preference and task-flow example](packages/experimental/task-strategy/cordis.source.patch.yml)
- [Strategy subsystem and API reference](docs/subsystems/task-strategy.md)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

This command runs the upstream npm release, not this fork's strategy enhancement. Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/sdaniasdsd/dsh-change.git dsh-policy-version
cd dsh-policy-version
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

The command above launches without the strategy layer. To enable it, follow the [DSH source trial](packages/experimental/task-strategy/README.md#use-this-package) with the supplied source patch; that section owns the launch command and configuration details. The [Gitee mirror](https://gitee.com/chunyouzhidi/dsh-policy-version) contains the same enhanced source.

## Community and support

- Report strategy-edition issues in [this fork's issue tracker](https://github.com/sdaniasdsd/dsh-change/issues); upstream feedback belongs in [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
