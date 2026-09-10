# Agent Instructions

Read this file first for every task. Then read the nearest deeper `AGENTS.md` for the area you are changing.

Inheritance rule: root instructions remain in force unless a deeper `AGENTS.md` explicitly replaces them.
Keep deeper `AGENTS.md` files additive and minimal: list only area-specific rules, workflows, or exceptions instead of repeating root guidance.

Shared library path (keep stable for antigravity and other apps/agents): `.agent/`

Always-on rules:
- `.agent/rules/verify-changes-with-tests.md`
- `.agent/rules/backend-crud-boundary.md`
- `.agent/rules/canonical-metric-display.md`
- `.agent/rules/firestore-write-sanitization.md` for any frontend/functions write path that persists event or activity data
- Never patch or directly modify files under `node_modules/`.
- Use prefixed commit subjects: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
- Pick the dominant intent; do not create unprefixed commit subjects.
- When asked to commit, use unsigned commits by default (`git commit --no-gpg-sign`) unless the user explicitly asks for a signed commit.
- After completing implementation changes, create an unsigned commit by default, staging only files changed for the current task with explicit paths.
- When working in a worktree whose branch already has an open PR, completing requested fixes or changes includes pushing
  the verified commits to that same PR branch and updating its description/verification notes as needed. Do not stop at
  a local commit or ask for another push request. Verify the PR head matches the local commit before reporting completion.
  This is standing authorization for that feature branch and its existing PR only: do not push the base branch, force-push,
  merge, or deploy without separate explicit authorization. An explicit instruction not to push overrides this workflow.
  Outside this existing-PR workflow, do not push unless the user explicitly asks.
- Whenever creating a GitHub issue or epic for this repository, add it to the `Quantified Self IO` GitHub Project
  (`jimmykane` user project 2) in the same task and verify project membership before reporting completion. Add newly
  created subissues as project items too; preserve existing project status and do not infer a status change unless the
  user requests one or the agreed workflow clearly requires it.
- When building a feature, review the app help page and update or add help content when needed.
- Before changing the Training workspace, Training settings, Training-derived metrics, or sports-lib durability integration,
  read `docs/training-workspace.md` completely and update the relevant sections in the same change. Keep this as the
  single detailed Training source of truth instead of creating a competing Training architecture document.
- For any MCP tool, response, scope, consent, exposed metric or data contract, instruction, plugin metadata, branding,
  or bundled-skill change, follow `.agent/skills/mcp-metric-surface/SKILL.md`.
- For any provider or service integration addition or material change, follow
  `.agent/skills/connected-provider-integration/SKILL.md`.
- For read-only Sentry queries in this repository, source `$HOME/.config/sentry/personal.env` only for the Sentry API command. Infer the organization and project from the `sentry:upload-sourcemaps` script in `package.json`; never print the token or profile contents.
- Never deploy, publish releases, or otherwise mutate production/cloud infrastructure unless the user gives explicit approval for that specific action in the current conversation. The existing-PR workflow above authorizes Git branch/PR updates only. Requests to implement, fix, commit, push code, prepare a deployment, continue, or "go" do not authorize a deployment. Prepare and verify changes locally, then report the exact manual command or ask for separate explicit deployment approval.
- Never delete, purge, or disable any Firebase data or resource without separate explicit approval that identifies the exact target and scope. This includes Firestore documents or collections, Authentication users, Storage objects, Functions, Hosting releases, Extensions, scheduled jobs, task queues, configuration, and secrets. Prior approval for a deployment or a different deletion does not carry over; read-only inspection is allowed.

Layer entry points:
- Frontend: `src/AGENTS.md`
- Functions: `functions/AGENTS.md`
- Extensions: `extensions/AGENTS.md`

Documentation routing:
- Put durable architecture, data-flow, operational, and maintenance documentation under `docs/` and link new entry
  points from the Architecture Documentation section in `README.md`.
- Put Training implementation details, calculations, product rules, diagnostics, extension guidance, and maintenance
  checklists in `docs/training-workspace.md`.
- Put user-facing explanations in the app help content as required by the feature rule above; developer documentation
  does not replace product help.
- Put area-specific agent instructions in the nearest deeper `AGENTS.md`, keeping them additive and minimal.
- Never store credentials, tokens, private keys, personal user data, or production exports in repository documentation.
