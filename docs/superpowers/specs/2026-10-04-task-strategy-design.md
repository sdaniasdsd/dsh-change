# Task strategy component

The user authorizes building an independent strategy component, using DSH's composition approach for integration without adding strategies to the plugin registry. This specification supersedes the FIFO-only task-dispatch draft.

## Decision and execution

A framework-independent strategy registry accepts author-written decision functions. Each function receives the task and author preferences and returns an execution plan. The plan contains ordered stages; tasks within a stage can run concurrently. Each task chooses an existing DSH agent preset (the plugin composition), an optional tool restriction, a model override, and an instruction. Prior-stage results are passed as labelled data to the next stage. A non-completed child stops later stages; cancellation aborts active children and prevents pending starts.

The strategy registry neither installs nor registers DSH plugins. A separate Cordis adapter exposes it through dependency injection, scoped registrations, model tools, and original DSH jobs. The adapter uses original in-process spawn execution. An optional one-shot `agentPreset` request selects a child composition before its first turn; requests without it preserve existing parent-preset inheritance. Continuable children are unchanged.

## First delivery

The upper agent can list author strategies, preview a decision, and run either a selected strategy or its own explicit execution plan. Declarative strategies ship only in an opt-in source overlay. Authors can edit those definitions or register custom decision functions; preferences are input to those functions, not a hardcoded framework policy. Existing presets define plugin combinations, and authors can define new presets through original DSH composition.

Original jobs own run identity, cancellation, owner isolation, bounded output retention, and progress presentation. Each run captures its plan and executor dependencies. Adapter unload cancels and drains its runs; parent disposal uses original job teardown. Stage width, total task count, retained intermediate-result bytes, and model-facing output size are configurable. The first delivery has no distributed worker, durable queue, filesystem isolation, automatic retry, or new UI dashboard. Concurrent writes require author coordination. DSH sandbox and approval behavior remains unchanged.

## Evidence

Tests cover explicit child preset selection, unchanged inheritance, invalid presets, strategy registration disposal, author preferences, phase ordering, bounded concurrency, failure, cancellation, input limits, and dependency disposal. A Loader-composed test executes original DSH children with a keyless scripted model and snapshots model-visible plan/run output. Build the component and launch an opt-in web profile on a separate local port; verify that the strategy tools are present rather than merely showing stock DSH.
