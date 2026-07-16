# Agent Instructions

Read this file first for every task. Then read the nearest deeper `AGENTS.md` for the area you are changing.

Inheritance rule: root instructions remain in force unless a deeper `AGENTS.md` explicitly replaces them.
Keep deeper `AGENTS.md` files additive and minimal: list only area-specific rules, workflows, or exceptions instead of repeating root guidance.

Shared library path (keep stable for antigravity and other apps/agents): `.agent/`

Always-on rules:
- `.agent/rules/verify-changes-with-tests.md`
- `.agent/rules/firestore-write-sanitization.md` for any frontend/functions write path that persists event or activity data
- Never patch or directly modify files under `node_modules/`.
- Use prefixed commit subjects: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
- Pick the dominant intent; do not create unprefixed commit subjects.
- When asked to commit, use unsigned commits by default (`git commit --no-gpg-sign`) unless the user explicitly asks for a signed commit.
- When building a feature, review the app help page and update or add help content when needed.
- Before changing the Training workspace, Training settings, Training-derived metrics, or sports-lib durability integration,
  read `docs/training-workspace.md` completely and update the relevant sections in the same change. Keep this as the
  single detailed Training source of truth instead of creating a competing Training architecture document.
- When adding a new provider/service integration, add or update a focused public `/integrations/<provider>` page when it has a clear product or search purpose. Keep integration routes intentional, and update route metadata, sitemap/robots, internal links, help content, and tests alongside the page.
- For read-only Sentry queries in this repository, source `$HOME/.config/sentry/personal.env` only for the Sentry API command. Infer the organization and project from the `sentry:upload-sourcemaps` script in `package.json`; never print the token or profile contents.
- Never deploy, publish, push, or otherwise mutate production/cloud infrastructure as part of an implementation task. Prepare and verify changes locally, then report the exact manual command or ask for a separate explicit approval for that specific action.

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
