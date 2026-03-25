# Agent Instructions

Read this file first for every task. Then read the nearest deeper `AGENTS.md` for the area you are changing.

Inheritance rule: root instructions remain in force unless a deeper `AGENTS.md` explicitly replaces them.
Keep deeper `AGENTS.md` files additive and minimal: list only area-specific rules, workflows, or exceptions instead of repeating root guidance.

Shared library path (keep stable for antigravity and other apps/agents): `.agent/`

Always-on rules:
- `.agent/rules/verify-changes-with-tests.md`
- `.agent/rules/firestore-write-sanitization.md` for any frontend/functions write path that persists event or activity data
- When building a feature, review the app help page and update or add help content when needed.

Layer entry points:
- Frontend: `src/AGENTS.md`
- Functions: `functions/AGENTS.md`
- Extensions: `extensions/AGENTS.md`
