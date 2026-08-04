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
  -> atomic existing per-plan AI quota reservation
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

- `assistantChat`: validates the prompt, client-generated request ID, and IANA timezone; consumes quota when
  grounded-answer processing begins; invokes the grounded runtime; and commits one completed user/assistant turn.
- `getAssistantQuotaStatus`: returns the signed-in user's current Assistant allowance without exposing the server-owned
  usage ledger.
- `getAssistantConversation`: reads the current server-owned conversation for the signed-in user.
- `resetAssistantConversation`: replaces the active conversation generation so an older in-flight response cannot
  restore cleared content.

All four require Firebase Authentication and App Check. Before a chat turn can reserve quota or send data to Gemini,
the backend also verifies the required privacy, data, and Terms agreements in the server-authoritative legal document.
Firestore rules deny browser access to `users/{uid}/assistantConversations/active`.

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
large output schemas are therefore not duplicated into the Gemini tool declaration. For the six tools where a timezone
is unconditionally required, the model-facing schema permits omission and the runtime supplies the browser's validated
IANA timezone before canonical MCP validation; an explicit timezone selected from the user's request remains unchanged.
Conditionally timed activity discovery is not defaulted, so unbounded history remains a valid mode. The runtime allows at most six
tool calls, seven model turns, 512 KiB of cumulative validated tool output, 1,024 output tokens for initial tool
selection, and 2,048 output tokens for each continuation response per user turn. The final stored answer remains capped
at 4,000 characters. Tool failures, schema failures, budget failures, and ungrounded responses fail the request rather
than producing an unsupported answer.

The model receives only:

- the current user message and IANA timezone;
- at most the latest six completed conversation turns;
- the MCP server instructions and allowlisted tool schemas;
- the bounded validated outputs of tools selected for the current question, with direct in-app URLs removed before
  model delivery.

Opaque references and cursors remain available to the model only because bounded follow-up detail and pagination calls
need them. After generation, the runtime rejects any answer that repeats an exact opaque reference, opaque cursor, or
direct app URL from the current tool results. The user-facing evidence adapter can still turn a validated app URL into
an explicit safe link without sending that URL to Gemini.

System instructions require clear missing-data handling, separation of facts from cautious interpretation, no diagnosis
or workout prescription, and no chain-of-thought disclosure. They are defense in depth; authorization, schema
validation, budgets, and data projections enforce the actual boundary.

The published examples are executable contracts, not disconnected marketing copy. `shared/assistant.prompts.ts` owns
the prompt text, supported tool workflow, and a narrow routing hint for every example shown on the Assistant page,
composer, or public home page. An exact case- and whitespace-insensitive match adds that repository-owned workflow to
the model's system instructions, while the user's message remains untrusted. The runtime fails closed if a workflow
tool is absent or generation does not invoke the declared tools in order. Tests execute every current example through
every declared mocked MCP workflow tool and verify each workflow against the production MCP tool registry. The
Assistant examples are therefore the only conversational prompt catalog that needs maintenance. Each model generation
phase receives fresh dynamic Genkit action objects so their request-local registries do not produce
duplicate-registration errors during discovery-and-answer workflows.

## Grounded evidence

The model writes only the answer. Evidence shown in the UI is generated deterministically from validated tool results,
not authored by the model. The evidence adapter:

- caps evidence at six tool results, six compact facts per result, and three app links;
- removes identifiers, cursors, source/provider/device provenance, tokens, and similar fields again before display;
- accepts production links only on exact HTTPS Quantified Self origins, with explicit loopback origins permitted only
  while running the Functions emulator;
- never stores raw tool output in the conversation document.

This evidence is a compact audit aid, not a full transcript of internal tool calls.

## Conversation lifecycle and quota

There is one active document at `users/{uid}/assistantConversations/active`:

- at most 12 messages, representing six completed turns;
- `createdAt`, `updatedAt`, and `expireAt` timestamps;
- an opaque conversation generation ID;
- one four-minute pending-turn lease to serialize requests.

Each browser send also carries a client-generated opaque request ID. That ID becomes the stored user-message ID, so a
retry after a lost callable response can return the already committed conversation without invoking Gemini or consuming
another request. Reusing an ID with different text is rejected. The page retains the ID only while the outcome is
ambiguous, clears it after a confirmed completion or authoritative conversation-generation change, and requires an
exact ID match when reconciling a response that may have been lost. This prevents another tab's same-text turn from
being mistaken for the current request.

Each completed turn refreshes `expireAt` to seven days. Starting a turn never renews that seven-day retention, but it
raises an imminent expiry only to the four-minute pending-turn deadline so TTL cannot delete a conversation while a
valid response is still being generated. A failed attempt can therefore retain an otherwise expiring conversation for
at most four extra minutes. The conversation becomes unavailable when `expireAt` passes; Firestore TTL deletes the
expired record asynchronously. **New chat** immediately replaces the document with a new generation and no messages.
Account deletion recursively removes the user document and all Assistant subcollection data. Every transactional
write, including failure cleanup, checks the shared user-deletion guard so an in-flight request cannot recreate data
after deletion starts.

The Assistant reuses the existing request ledger and role limits. A reservation is released if no model attempt
starts, such as when another turn owns the conversation lease. Once the reservation is finalized, a failed model or
tool attempt still consumes the request. Loading or resetting a conversation does not consume quota. Usage documents
are read directly by period ID, so their server-only fields and dynamic reservation map are exempt from automatic
single-field indexing. `periodEnd` deliberately remains indexed because the admin fallback orders historical usage by
that field when no current subscription period is available.

## Operations and rollout

Deploy the Firestore rules and single-field index exemptions before exposing the feature, then roll out the four
Assistant backend callables before the frontend route. The legacy AI Insights callable, deterministic prompt parser,
snapshot UI, chart pipeline, and prompt-repair writer have been removed; `/ai-insights` is now permanently owned by the
Assistant. The existing `aiInsightsUsage` Firestore collection name is retained only as a storage-compatibility key so
current billing-period request counts are not reset.

The retired `aiInsightsPromptRepairs` collection has no remaining writer. Its `expireAt` TTL policy is intentionally
kept as cleanup-only infrastructure until every historical record has drained, after which its field override and
README retention row can be removed. Legacy `users/*/aiInsightsRequests/latest` documents contain prompts and complete
responses but predate TTL fields, so draining them is a mandatory rollout step rather than optional retention. Run the
dedicated migration first in its default count-only mode, then execute its bounded recursive purge with explicit
project targeting:

```bash
npm --prefix functions run purge-legacy-ai-insights-snapshots -- --project=quantified-self-io
npm --prefix functions run purge-legacy-ai-insights-snapshots -- --project=quantified-self-io --execute
```

The execution is idempotent, processes at most 100 roots per batch by default, recursively deletes any unexpected
descendants, and fails unless the final collection-group count is zero. Keep the client deny rule in place throughout;
the Admin SDK migration does not require restoring browser access. Account deletion remains the defense-in-depth path
for any user root removed while rollout is in progress.

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
