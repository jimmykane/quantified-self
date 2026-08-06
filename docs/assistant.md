# MCP-backed built-in Assistant

## Product decision

Quantified Self offers two complementary conversational paths:

| Path | Best for | Who pays for inference | Data authority |
| --- | --- | --- | --- |
| Built-in Assistant at `/ai-insights` | Zero-setup questions inside the app | Quantified Self, subject to the existing per-plan request allowance | A conservative first-party coordinate-free MCP tool allowlist |
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

- `assistantChat`: validates the prompt, client-generated request ID, and IANA timezone; reserves quota while it
  prepares the grounded runtime; consumes it immediately before the first Gemini or MCP tool attempt; and commits one
  completed user/assistant turn.
- `getAssistantQuotaStatus`: returns the signed-in user's current Assistant allowance without exposing the server-owned
  usage ledger.
- `getAssistantConversation`: reads the current server-owned conversation and the opaque request ID of any active
  pending turn for the signed-in user.
- `resetAssistantConversation`: replaces the active conversation generation so an older in-flight response cannot
  restore cleared content.

All four require Firebase Authentication and App Check. Before a chat turn can reserve quota or send data to Gemini,
the backend also verifies the required privacy, data, and Terms agreements in the server-authoritative legal document.
Firestore rules deny browser access to `users/{uid}/assistantConversations/active`.

## Tool and data boundary

The internal session grants `metrics:read`, `measurements:read`, `sleep:read`, `activity-details:read`, and `routes:read`, then narrows
the exposed model tools to the explicit `ASSISTANT_MCP_TOOL_NAMES` allowlist. It covers:

- daily report and live Readiness;
- normalized sleep sessions, trends, and safe aggregate vitals;
- Training and activity metric discovery and bounded queries;
- first-class body-measurement discovery and bounded history;
- bounded activity lists, overview, selected metrics, rankings, laps, coordinate-redacted MTB jumps, and swim lengths;
- coordinate-free saved-route summaries filtered by canonical activity type, name, or recency.

The built-in Assistant does not receive activity-location or route-location scopes, route geometry, waypoints, exact
coordinates, nearby-location search, activity chart streams, original source files, write tools, or dashboard settings.
These exclusions are product and privacy boundaries, not merely prompt instructions. External MCP clients can request
separately approved location permissions; that is the intended path for exact-location and route-geometry questions.
Saved-route names are included in summaries and can themselves contain user- or provider-assigned place information.

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

Gemini `UNAVAILABLE` responses are treated as transient provider failures. Each model phase retries them at most twice
with bounded exponential backoff. If an otherwise recoverable grounded runtime attempt still fails—including a model
formatting or transient read failure—the callable rebuilds the in-process MCP session and makes one final complete
grounded attempt. Both attempts share the same idempotent quota boundary, pending-turn lease, and user request: the
fallback can add provider cost but cannot consume a second user allowance. Permanent callable errors and quota
finalization failures are not retried. Exhausting the retry budget still fails the callable without committing an
unsupported answer.

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

The published MTB example also locks the Assistant to the shared MCP superlative workflow: discover the Mountain Biking
activity-group value, pass it to the shared ranker so Sports Lib expands every canonical subtype, and follow the
server's maximum-jump mapping across the requested range or all available history. The ranked persisted maximum and unit
are authoritative. Coordinate-redacted jump records are read only when the user explicitly asks for subrecord details,
avoiding a redundant scan that can exceed the Assistant's turn budget on jump-heavy activities. This is the same ranking
path available to external MCP clients. It never substitutes `jumpCount` or a newest-first sample for jump quality, and
an over-budget all-history scan fails instead of being described as an all-time result.

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
- at most 512 private replay receipts containing only a request ID, request fingerprint, and completion time;
- `createdAt`, `updatedAt`, and `expireAt` timestamps;
- an opaque conversation generation ID;
- one four-minute pending-turn lease to serialize requests.

Each browser send also carries a client-generated opaque request ID. That ID becomes the stored user-message ID. On
completion, the server also records a SHA-256 request fingerprint in the private receipt array; it does not duplicate
the prompt or response. Receipts are independent of the 12-message transcript and capped at the 512 most recently
completed request IDs. They remain with the active conversation generation until **New chat** replaces it or Firestore
TTL removes the inactive document. An exact retry can therefore return the current committed conversation without
invoking Gemini or consuming another request even after the original messages leave the transcript. Reusing an ID with
different text is rejected. Documents from before this field existed derive receipts from their retained user messages
in memory and persist them on the next write.

While a send outcome is ambiguous, the page keeps a versioned, account-bound, bounded resumption record in tab-scoped
session storage: the Firebase UID, question, opaque request ID, IANA timezone, original conversation generation when
present, and submission time. A record is discarded without rendering or resubmission if the signed-in UID changes. This
lets a refreshed page render the pending question immediately. If the refresh cancelled the HTTP request before the
server registered its turn, the page resubmits the same question with the same request ID; server idempotency prevents a
duplicate completed turn or duplicate quota charge. A first request may also resume into the empty conversation generation
that its interrupted server call created, but never into a populated or mismatched generation. A record older than the
four-minute turn lease plus the 30-second recovery margin is never sent automatically and is instead restored to the
composer. The server also returns the request ID attached to an active pending lease. After a reload, the page polls that
owner-only callable with a bounded
two-to-five-second progressive interval until the exact turn is committed or the lease ends. Legacy ID-only records keep
a 15-second registration grace. Permanent authorization or response-contract failures stop polling. The local resumption
record is cleared after confirmed completion, authoritative failure, conversation reset, or expiry, and an exact ID match
is required when reconciling a response that may have been lost. When the server authoritatively ends a turn without a
completed answer, the page restores the exact tab-scoped question to the composer and reports that specific question as
ready to send again instead of presenting it as an unknown previous request. This prevents another tab's same-text turn
from being mistaken for the current request.

Each completed turn refreshes `expireAt` to seven days. Starting a turn never renews that seven-day retention, but it
raises an imminent expiry only to the four-minute pending-turn deadline so TTL cannot delete a conversation while a
valid response is still being generated. A failed attempt can therefore retain an otherwise expiring conversation for
at most four extra minutes. The conversation becomes unavailable when `expireAt` passes; Firestore TTL deletes the
expired record asynchronously. **New chat** immediately replaces the document with a new generation, no messages, and
no replay receipts, so an old response cannot be replayed into a replacement conversation.
Account deletion recursively removes the user document and all Assistant subcollection data. Every transactional
write, including failure cleanup, checks the shared user-deletion guard so an in-flight request cannot recreate data
after deletion starts.

The Assistant reuses the existing request ledger and role limits. A reservation remains releasable while MCP session
creation, tool discovery, and other non-billable setup runs. It is finalized immediately before the first Gemini model
or MCP tool attempt; a defensive completion fallback prevents a grounded answer from being committed uncharged. A
setup failure therefore releases the reservation, while a failed model or tool attempt still consumes the request.
Loading or resetting a conversation does not consume quota. Usage documents are read directly by period ID, so their
server-only fields and dynamic reservation map are exempt from automatic single-field indexing. `periodEnd`
deliberately remains indexed because the admin fallback orders historical usage by that field when no current
subscription period is available.

## Operations and rollout

Deploy the Firestore rules and single-field index exemptions before exposing the feature, then roll out the four
Assistant backend callables before the frontend route. The legacy AI Insights callable, deterministic prompt parser,
snapshot UI, chart pipeline, and prompt-repair writer have been removed; `/ai-insights` is now permanently owned by the
Assistant. The new `users/{uid}/assistantUsage/{periodId}` ledger deliberately starts empty and never reads the
retired `aiInsightsUsage` collection, so this release resets every account's Assistant allowance. The Admin user list
reads the same new ledger, so its request count resets with the callable.

The retired `aiInsightsRequests`, `aiInsightsUsage`, and `aiInsightsPromptRepairs` collection groups have no remaining
writer. They can contain historical prompts, responses, and usage state, so draining all three is a mandatory rollout
step rather than optional retention. First deploy the new Functions, rules, and index configuration (which adds the
`assistantUsage` exemptions while retaining the retired ones). Wait at least ten minutes after the Functions rollout
finishes so no old revision can finalize a legacy reservation, then run the dedicated migration first in its default
count-only mode and finally execute its bounded recursive purge with explicit project targeting:

```bash
npm --prefix functions run purge-retired-ai-insights-data -- --project=quantified-self-io
npm --prefix functions run purge-retired-ai-insights-data -- --project=quantified-self-io --execute
```

The count-only dry run reports collection-group totals. Execution is idempotent, processes at most 100 documents per
group and batch by default, and recursively deletes any unexpected descendants. Before scheduling a deletion, it
verifies the document is at one of the exact legacy paths; a collection-group name collision therefore fails closed
rather than expanding the purge's scope. It fails unless all three final collection-group counts are zero. Keep the
client deny rule in place throughout; the Admin SDK migration does not require restoring browser access. The retired
single-field overrides and prompt-repair TTL stay in `firestore.indexes.json` until this command confirms zero
documents, so a standard deploy never re-enables automatic indexes for data that is about to be deleted. Remove those
retired overrides only in a subsequent configuration-only deployment after the successful purge. Account deletion
remains the defense-in-depth path for any user root removed while rollout is in progress.

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
4. Add positive routing tests plus negative leakage tests for identifiers, provenance, files, route geography, and coordinates.
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
voice, location access, route geometry or waypoints, chart-stream analysis, write actions, dashboard arrangement, or medical recommendations.
Any expansion needs an explicit product decision, privacy review, bounded data contract, quota/cost model, and rollback
plan. Exact-location or route-geometry support should normally remain in the external MCP path where the user approves those scopes.
