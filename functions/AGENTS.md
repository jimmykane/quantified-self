# Functions Agent Instructions

Read `/Users/dimitrios/Projects/quantified-self/AGENTS.md` first.

Functions-only rules:
- `../.agent/rules/security-reviewer.md`
- `../.agent/rules/firestore-recursive-delete-cleanups.md`
- Any MCP tool, response, metric, activity/route projection, sleep field, or Training-derived payload change must update
  the strict output schema and transport fixtures, preserve `structuredContent` plus JSON-text compatibility, run
  `src/mcp/tool-output-schemas.spec.ts` and `npm --prefix functions run mcp:contract:check`, and update
  `docs/mcp-server.md`. Existing registered schemas are frozen; compatible metadata changes require the documented
  digest-bound refresh/publication record. Update the baseline and append-only transition history only through the
  verified promotion command.

Workflows:
- `../.agent/workflows/start-emulators.md`
