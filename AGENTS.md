# Agent Instructions

Read this file first for every task. Then read the nearest deeper `AGENTS.md` for the area you are changing.

Inheritance rule: root instructions remain in force unless a deeper `AGENTS.md` explicitly replaces them.
Keep deeper `AGENTS.md` files additive and minimal: list only area-specific rules, workflows, or exceptions instead of repeating root guidance.

Shared library path (keep stable for antigravity and other apps/agents): `.agent/`

Always-on rules:
- `.agent/rules/verify-changes-with-tests.md`
- `.agent/rules/firestore-write-sanitization.md` for any frontend/functions write path that persists event or activity data
- Never patch or directly modify files under `node_modules/`.
- Do not default to new backend functions for CRUD. Prefer direct, owner-scoped Firestore SDK access with Security Rules
  and client transactions/batches when those can safely and reasonably enforce the required invariants. Client-side
  validation alone is not a security boundary; preserve authorization, validation, concurrency, retry, and account-deletion
  guarantees regardless of where the operation runs. Sensitive data, revision checks, or safe retries alone do not
  automatically justify a callable.
- Before adding a callable or HTTP function, inspect existing paths and explain the concrete server-side requirement and
  why Rules/client transactions or an existing backend path are insufficient. Valid reasons include server-held secrets,
  privileged/cross-account operations, verified provider callbacks, background work, or invariants Rules cannot reasonably
  enforce. When backend work is justified, reuse existing domain helpers; do not introduce generic CRUD endpoints or
  speculative infrastructure. This guidance does not authorize refactoring existing write paths outside the requested scope.
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
- When adding a new indexable public page, add it to `src/sitemap.xml` in the same change. Also verify its `robots.txt` policy, SSR/prerender registration, route SEO metadata, public-route handling, internal links, and tests. Deliberately exclude non-indexable pages from the sitemap and set their `noindex` policy where applicable.
- Before changing the Training workspace, Training settings, Training-derived metrics, or sports-lib durability integration,
  read `docs/training-workspace.md` completely and update the relevant sections in the same change. Keep this as the
  single detailed Training source of truth instead of creating a competing Training architecture document.
- For every user-facing rendering of a canonical metric—cards, tables, chart axes/tooltips/legends, accessible text,
  exports, and generated summaries—use its Sports Lib data class for both the display value and display unit. Never
  hand-format canonical numeric values, read a unit directly from stored/catalog data for display, or hard-code a unit
  abbreviation. Apply the signed-in user's `settings.unitSettings` through the shared
  `shared/unit-aware-display.ts` helpers (which use Sports Lib's `DynamicDataLoader` conversion) before calling
  `getDisplayValue()` and `getDisplayUnit()`; both must come from the same converted Sports Lib instance. For canonical
  Health/Sleep metrics, first use their explicit mapping in `shared/sports-lib-health-data.ts`. Only explicitly
  native-only or non-comparable provider values may use a provider-labelled fallback, and they must never be presented
  as canonical or user-unit-converted. Add display tests for the default unit settings and a relevant non-default user
  unit preference whenever adding or changing a metric surface.
- Before adding or changing an MCP tool or response field, a Sports Lib event metric, an activity/route projection, a
  Training-derived metric kind or payload, or a normalized sleep field, read
  `.agent/skills/mcp-metric-surface/SKILL.md` and `docs/mcp-server.md`. Update the exhaustive strict output-schema
  registry in the same change, preserve validated `structuredContent` plus equivalent JSON text, add or update negative
  leakage fixtures, run the MCP output contract suite and `npm --prefix functions run mcp:contract:check`, and keep the
  MCP documentation current. Existing registered tool schemas are frozen; follow the documented digest-bound
  refresh/publication lifecycle for compatible additive metadata, and never hand-edit the registered baseline or its
  append-only transition history.
- On the external MCP authorization screen, initialize the selected permissions from the complete validated scope list
  returned for the authorization request. Every requested current or future permission must start checked, while the
  user must remain able to uncheck individual permissions before approval. Do not add per-scope default-off filters;
  preserve scope dependency rules and remember that preselection alone never grants access without explicit approval.
- When MCP tools, schemas, scopes, instructions, plugin metadata, starter prompts, branding, or any bundled Quantified
  Self plugin skill change, follow the local-plugin update matrix in `docs/mcp-server.md`. Review every affected focused
  skill and the cross-domain skill, and keep the exhaustive bundled-skill registry, fixtures, per-skill starter prompts,
  MCP dependencies, and validation aligned. Run `npm run plugin:tools`,
  `npm --prefix tools/quantified-self-plugin test`, and `npm run plugin:validate` with a fixture app ID, and state
  whether the registered ChatGPT app needs a rescan or the local plugin needs `npm run plugin:sync`. Never commit the
  generated `.app.json`, generated cache-busted manifest, local app ID configuration, or installed plugin cache.
- When adding a new provider/service integration, add or update a focused public `/integrations/<provider>` page when it has a clear product or search purpose. Keep integration routes intentional, and update route metadata, sitemap/robots, internal links, help content, and tests alongside the page.
- When adding or materially changing a provider/service integration, update `docs/provider-integration-guide.md` in the same change. Keep its provider matrix, implementation checklist, lifecycle guidance, operational coverage, and pitfalls accurate.
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
