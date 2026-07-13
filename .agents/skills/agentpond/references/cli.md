# AgentPond data-access CLI

Run AgentPond through `npx` unless it is installed globally.

## Select data

Firebase project selection is owned by Firebase:

```bash
firebase use <alias-or-project-id>
npx agentpond sync
```

AgentPond detects the Firebase root from `.firebaserc` or `firebase.json`, follows the active selection stored by the Firebase CLI even when `.firebaserc` is absent, uses that project ID for the local cache name, reads the Firebase project data, and ignores AgentPond environment selection.

`npx agentpond init` verifies that both AgentPond skills exist after installation. Cancelling the Skills CLI stops setup without printing a success message or coding-agent prompt.

For non-Firebase storage, select an existing environment:

```bash
npx agentpond env current
npx agentpond env list
npx agentpond env use production
npx agentpond --env staging sync
```

Sync the selected environment before querying when recent data matters.

## Query commands

```bash
npx agentpond sync
npx agentpond sync --json

npx agentpond traces list --limit 25
npx agentpond traces get <trace-id>
npx agentpond observations list --traceId <trace-id>

npx agentpond sessions list
npx agentpond sessions get <session-id>

npx agentpond scores list --traceId <trace-id>
npx agentpond scores list --observationId <observation-id>

npx agentpond sql "select * from traces limit 10"
npx agentpond sql "select * from scores where trace_id = '<trace-id>'" --json
```

Use JSON output when another tool needs to consume the result. Use focused commands for individual resources and SQL for aggregation, joins, time filtering, raw events, and cost analysis.
