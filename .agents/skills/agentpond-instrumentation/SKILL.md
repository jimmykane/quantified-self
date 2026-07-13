---
name: agentpond-instrumentation
description: Add OpenInference tracing to a Firebase server application and export spans directly to AgentPond through Firebase Storage. Use when instrumenting an untraced Firebase AI application, adding a missing OpenInference integration, or adapting an existing OpenTelemetry setup to use createFirebaseSpanExporter().
---

# AgentPond Instrumentation

Instrument Firebase AI applications without changing business behavior. Analyze the target service first, reuse existing tracing infrastructure, and keep Firebase Admin and trace export strictly server-side.

Read these references when relevant:

- Firebase Admin, exporter, and Storage Rules: [references/firebase.md](references/firebase.md)
- OpenInference routing, custom spans, sessions, and verification: [references/openinference.md](references/openinference.md)

## Core principles

- Inspect before editing. Confirm the service, runtime, package manager, AI SDK, framework, and existing telemetry.
- Instrument only trusted server code. Never import `firebase-admin` or `@agentpond/firebase` into browser or client bundles.
- Prefer framework or provider auto-instrumentation. Add manual spans only for application logic, chains, tools, or gaps.
- Reuse the existing Firebase default app and global OpenTelemetry provider. Do not register a competing provider.
- Initialize tracing before importing or constructing instrumented AI clients.
- Keep tracing additive and follow the repository's conventions.
- Never add credentials to source code or ask the user to paste secrets into chat.

## Phase 0: preflight

1. Confirm which Firebase service should be instrumented. In a monorepo, do not assume every Functions source or server package is in scope.
2. Identify the build, typecheck, start, emulator, and real-request commands needed for verification.
3. Confirm the target is a trusted Node.js server runtime. If only client code exists, stop and ask whether the user wants to add a server function or another trusted runtime.
4. Read [references/firebase.md](references/firebase.md) before proposing Firebase changes.

## Phase 1: read-only analysis

Do not write files or install packages during this phase.

1. Inspect `firebase.json`, `.firebaserc`, package manifests, lockfiles, and server entrypoints.
2. Scan imports to identify:
   - AI providers and clients
   - agent or LLM frameworks
   - existing OpenInference or OpenTelemetry setup
   - Firebase Admin initialization
   - request, conversation, and tool execution boundaries
3. Find the Storage Rules file configured by `firebase.json` and review whether any matching client rule can access `agentpond/**`.
4. Prefer a framework-native OpenInference integration when it captures model and tool spans. Add a provider instrumentor only for a documented gap.
5. Return a concise proposal containing:
   - target service and package manager
   - detected AI SDKs and framework
   - packages to install
   - existing Firebase and telemetry initialization to reuse
   - Storage Rules status
   - files and verification commands expected to change

Stop after presenting the proposal and ask for explicit confirmation before installing packages or editing files. The initial request to instrument the project does not replace confirmation of the analyzed target, package choices, files, and Storage Rules changes.

## Phase 2: implementation

1. Read current official integration documentation for the detected framework or AI client.
2. Install packages with the project's package manager:
   - `@agentpond/firebase`
   - required OpenTelemetry SDK packages
   - the matching `@arizeai/openinference-*` package
   - `firebase-admin` only when the trusted server package does not already provide it
3. Create or update one centralized server instrumentation module.
4. Reuse an existing default Firebase Admin app. Add default initialization only when it is absent; follow [references/firebase.md](references/firebase.md).
5. Create `createFirebaseSpanExporter()` after the default app exists.
6. Add the exporter to the existing provider. When no provider exists, create one using APIs supported by the installed OpenTelemetry version and prefer NodeSDK's batched `traceExporter` configuration or an explicit `BatchSpanProcessor`.
7. Register the selected OpenInference instrumentation before AI clients are created.
8. Add manual CHAIN and TOOL spans only where auto-instrumentation leaves important application behavior invisible.
9. Preserve one `session.id` across all turns in the same conversation.
10. Fix unsafe Storage Rules before declaring instrumentation complete. Do not add a standalone false rule as a supposed override for a broader allow.

## Verification

Treat the work as complete only when:

1. The project builds or typechecks.
2. The server starts or its emulator loads the instrumentation without duplicate-provider or duplicate-app errors.
3. One real AI request produces OpenInference spans.
4. Storage Rules do not grant client SDK access to `agentpond/**`.
5. The trace is visible after:

```bash
npx agentpond sync
npx agentpond traces list --limit 10
```

Inspect the trace and confirm model, CHAIN, TOOL, input/output, parent-child, and session attributes that apply to the application. For short-lived processes, force-flush before exit. Do not shut down a reusable module-level provider after every Firebase request.

## Attribution

This workflow is adapted from Arize AI's MIT-licensed [arize-instrumentation skill](https://github.com/Arize-ai/arize-skills/tree/main/skills/arize-instrumentation). It replaces Arize-specific export and verification with AgentPond and Firebase Storage while retaining the analyze-then-implement workflow.
