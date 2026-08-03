# MCP-backed built-in Assistant

## Product decision

Quantified Self offers two complementary conversational paths:

| Path | Best for | Who pays for inference | Data authority |
| --- | --- | --- | --- |
| Built-in Assistant at `/ai-insights` | Zero-setup questions inside the app | Quantified Self, subject to the existing per-plan request allowance | A conservative first-party non-location MCP tool allowlist |
| External MCP client | ChatGPT or another compatible bring-your-own-AI experience | The external client or user | The scopes explicitly approved in MCP authorization |

The built-in Assistant is not a second fitness-data API. It connects an in-process MCP client to the same canonical
MCP server, schemas, projections, and Sports Lib-backed metric discovery used by authorized external clients. The
public URL remains `/ai-insights` so existing links and post-auth return URLs continue to work, but that route now loads
the conversational Assistant.

## Request architecture

```text
Angular Assistant page
  -> Auth + App Check callable
  -> existing per-plan AI quota reservation
  -> server-owned conversation turn lock
  -> in-process MCP Client + InMemoryTransport
  -> createMcpServer with curated first-party scopes and tool allowlist
  -> existing MCP data service, strict output schemas, and Sports Lib catalogs
  -> dynamically generated Genkit tools
  -> Gemini answer
  -> deterministic evidence projection
  -> bounded conversation completion
```

The in-memory transport deliberately avoids a public HTTP request and OAuth loop. It still exercises the real MCP tool
registration, scope checks, input schemas, output validation, and data projections. `functions/src/assistant/mcp-session.ts`
must fail closed if any required allowlisted tool disappears. Authenticated app links use only an allowlisted production
or Beta caller origin (or loopback while running the Functions emulator), with the production origin as a safe fallback.

The callable surface consists of:

- `assistantChat`: validates the prompt and IANA timezone, consumes quota when grounded-answer processing begins, invokes the grounded
  runtime, and commits one completed user/assistant turn.
- `getAssistantConversation`: reads the current server-owned conversation for the signed-in user.
- `resetAssistantConversation`: replaces the active conversation generation so an older in-flight response cannot
  restore cleared content.

All three require Firebase Authentication and App Check. Firestore rules deny browser access to
`users/{uid}/assistantConversations/{conversationId}`.

## Tool and data boundary

The internal session grants `metrics:read`, `measurements:read`, `sleep:read`, and `activity-details:read`, then narrows
the exposed model tools to the explicit `ASSISTANT_MCP_TOOL_NAMES` allowlist. It covers:

- daily report and live Readiness;
- normalized sleep sessions, trends, and safe aggregate vitals;
- Training and activity metric discovery and bounded queries;
- first-class body-measurement discovery and bounded history;
- bounded activity lists, overview, selected metrics, rankings, laps, coordinate-redacted MTB jumps, and swim lengths.

The built-in Assistant does not receive route scopes, activity-location scope, saved routes, route geometry, exact
coordinates, activity chart streams, original source files, write tools, or dashboard settings. These exclusions are
product and privacy boundaries, not merely prompt instructions. External MCP clients can request separately approved
route and location permissions; that is the intended path for those questions.

Every current answer must execute at least one allowlisted tool. Genkit tools are built from the MCP server's live JSON
input schemas. MCP validates every structured result against its strict output schema before the model receives it; the
large output schemas are therefore not duplicated into the Gemini tool declaration. The runtime allows at most six
tool calls, seven model turns, and 512 KiB of cumulative validated tool output per user turn. Tool failures, schema
failures, budget failures, and ungrounded responses fail the request rather than producing an unsupported answer.

The model receives only:

- the current user message and IANA timezone;
- at most the latest six completed conversation turns;
- the MCP server instructions and allowlisted tool schemas;
- the bounded validated outputs of tools selected for the current question.

System instructions require clear missing-data handling, separation of facts from cautious interpretation, no diagnosis
or workout prescription, and no chain-of-thought disclosure. They are defense in depth; authorization, schema
validation, budgets, and data projections enforce the actual boundary.

## Grounded evidence

The model writes only the answer. Evidence shown in the UI is generated deterministically from validated tool results,
not authored by the model. The evidence adapter:

- caps evidence at six tool results, six compact facts per result, and three app links;
- removes identifiers, cursors, source/provider/device provenance, tokens, and similar fields again before display;
- accepts links only on HTTPS Quantified Self hosts;
- never stores raw tool output in the conversation document.

This evidence is a compact audit aid, not a full transcript of internal tool calls.

## Conversation lifecycle and quota

There is one active document at `users/{uid}/assistantConversations/active`:

- at most 12 messages, representing six completed turns;
- `createdAt`, `updatedAt`, and `expireAt` timestamps;
- an opaque conversation generation ID;
- one four-minute pending-turn lease to serialize requests.

Each completed turn refreshes `expireAt` to seven days. The conversation becomes unavailable when that timestamp passes;
Firestore TTL deletes the expired record asynchronously. **New chat** immediately replaces the document with a new
generation and no messages. Account deletion recursively removes the user document and all Assistant subcollection
data. Every transactional write, including failure cleanup, checks the shared user-deletion guard so an in-flight
request cannot recreate data after deletion starts.

The Assistant reuses the existing AI request ledger and role limits. A reservation is released if no model attempt
starts, such as when another turn owns the conversation lease. Once the reservation is finalized, a failed model or
tool attempt still consumes the request. Loading or resetting a conversation does not consume quota.

## Operations, rollout, and rollback

Roll out the backend callables before the frontend route. A frontend rollback can point `/ai-insights` back to the
previous component while leaving the new server-owned documents to expire. A backend rollback must leave the shared
quota ledger compatible and must not relax Firestore rules for Assistant documents.

Do not log prompts, conversation text, tool arguments, tool output, coordinates, or user IDs from the Assistant path.
Operational logs should contain only safe error classes and lifecycle outcomes. Monitor callable errors, quota failures,
tool/schema drift, model latency, and abandoned turn locks. The generation callable caps both instances and per-instance
concurrency; preserve an explicit platform-level cost bound when changing its runtime options.

TTL policy deployment is an explicit infrastructure step. The local helper includes `assistantConversations`, but code
deployment alone does not enable or update the production TTL policy.

## Maintenance checklist

When an MCP tool, output field, Sports Lib metric, Training-derived metric, measurement, or normalized sleep field
changes:

1. Follow `.agent/skills/mcp-metric-surface/SKILL.md` and the public MCP lifecycle in `docs/mcp-server.md`.
2. Decide explicitly whether the built-in Assistant should receive it. Do not widen scopes or add tools implicitly.
3. Update the Assistant allowlist, system routing guidance, evidence projection, Help, policies, and this document when
   the boundary changes.
4. Add positive routing tests plus negative leakage tests for identifiers, provenance, files, routes, and coordinates.
5. Run the Assistant tests, MCP output contract suite, and `npm --prefix functions run mcp:contract:check`.
6. If the public registered MCP contract changed, follow its digest-bound publication and ChatGPT rescan lifecycle.
   An implementation-only Assistant change that leaves the public contract unchanged requires neither a registered
   app rescan nor local plugin sync.

## Verification

Minimum local verification for Assistant changes:

```bash
npm --prefix functions test -- --run src/assistant
npm --prefix functions run build
npm --prefix functions run mcp:contract:check
npm test -- --run src/app/components/assistant src/app/services/assistant.service.spec.ts
npm run test:rules
bash scripts/test-setup-ttl.sh
```

Also run the public Help/SEO content tests whenever capabilities, privacy, retention, or plan messaging changes.

## Deliberately deferred capabilities

The initial version does not include streaming responses, multiple named conversations, proactive notifications,
voice, route/location access, chart-stream analysis, write actions, dashboard arrangement, or medical recommendations.
Any expansion needs an explicit product decision, privacy review, bounded data contract, quota/cost model, and rollback
plan. Route or location support should normally remain in the external MCP path where the user approves those scopes.
