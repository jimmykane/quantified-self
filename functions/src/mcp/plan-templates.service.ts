import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HttpsError } from 'firebase-functions/v2/https';
import { TrainingScheduleMutationError } from '../training-plans/mutation';
import { applyEnrollment, getTemplate, listTemplates, previewEnrollment, summarizeTemplate, readPlanAttribution, templateId, scheduleOptions, type TemplateAccess } from '../training-plans/plan-templates';
import { encodeOpaqueValue, decodeOpaqueValue, McpDataError } from './data.service';
import { assertAuthorityInTransaction, type TrainingWriteInput } from './training-plans-write.service';
import { TEMPLATE_INPUTS, TEMPLATE_OUTPUTS, type TEMPLATE_TOOLS } from './plan-templates.schemas';
import { MCP_OAUTH_SCOPES } from './oauth.service';

const templateRef = z.strictObject({ kind: z.literal('plan-template'), id: z.string().regex(/^[\w-]{1,128}$/),
  source: z.enum(['catalog','private']), version: z.number().int().positive() });
const proposalRef = z.strictObject({ kind: z.literal('plan-enrollment'), id: z.string().uuid() });
const cursor = z.strictObject({ kind: z.literal('template-page'), digest: z.string(), offset: z.number().int().nonnegative(), source: z.enum(['catalog','private']), expires: z.number() });
type Input = TrainingWriteInput;
function encode(input: Input, value: Record<string, unknown>, proposal = false) {
  return encodeOpaqueValue(proposal ? 'training_proposal' : 'training_read', value, input.uid, input.connectionId);
}
function decode(input: Input, value: string, proposal = false) {
  return decodeOpaqueValue(proposal ? 'training_proposal' : 'training_read', value, input.uid, input.connectionId, 'Training plan template reference');
}
export function isPlanEnrollmentProposal(input: Input, value: string) {
  try { return proposalRef.safeParse(decode(input, value, true)).success; } catch { return false; }
}
function access(input: Input, write: boolean, confirmed?: string): TemplateAccess {
  return { uid: input.uid, connectionId: input.connectionId, check: async (tx, source, generation, apply) => {
    const required: string[] = [MCP_OAUTH_SCOPES.TrainingPlansRead];
    if (write) required.push(MCP_OAUTH_SCOPES.TrainingPlansWrite);
    if (source === 'private') required.push(MCP_OAUTH_SCOPES.PrivatePlanTemplatesRead);
    if (source === 'private' && !input.scopes.includes(MCP_OAUTH_SCOPES.PrivatePlanTemplatesRead))
      throw new McpDataError('invalid_request', 'Enable the separate private plan templates permission to read this library.');
    if (required.some(s => !input.scopes.includes(s)))
      throw new McpDataError('invalid_request', write ? 'Training read and changes permissions are required for enrollment.' : 'Training read permission is required.');
    return assertAuthorityInTransaction({ db: admin.firestore(), now: Date.now }, tx, input.uid, input.connectionId, required, generation, apply ? confirmed : undefined);
  } };
}
function project(input: Input, meta: ReturnType<typeof summarizeTemplate>) {
  const { id, ...fields } = meta;
  return { ...fields, templateRef: encode(input, { kind: 'plan-template', id, source: fields.source, version: fields.version }) };
}
export async function handleTemplateTool(tool: typeof TEMPLATE_TOOLS[number], input: Input) {
  try { return await runTemplateTool(tool, input); }
  catch (error) {
    if (error instanceof TrainingScheduleMutationError || error instanceof HttpsError)
      throw new McpDataError('invalid_request', error.message);
    if (error instanceof z.ZodError) throw new McpDataError('invalid_request', 'Invalid template request or reference.');
    throw error;
  }
}
async function runTemplateTool(tool: typeof TEMPLATE_TOOLS[number], input: Input) {
  if (tool === 'get_training_plan_attribution') {
    const { planRef } = TEMPLATE_INPUTS[tool].parse(input.arguments);
    const ref = z.strictObject({ kind: z.literal('plan'), id: templateId, createdAtMs: z.number().int().nonnegative() }).parse(decode(input, planRef));
    return TEMPLATE_OUTPUTS[tool].parse(await readPlanAttribution(access(input, false), ref.id, ref.createdAtMs));
  }
  if (tool === 'list_training_plan_templates') {
    const args = TEMPLATE_INPUTS[tool].parse(input.arguments);
    const items = await listTemplates(access(input,false), args.source);
    const digest = createHash('sha256').update(JSON.stringify(items.map(t => [t.id,t.version]))).digest('hex');
    const page = args.cursor ? cursor.parse(decode(input,args.cursor)) : null;
    if (page && (page.source !== args.source || page.digest !== digest || page.expires < Date.now())) throw new McpDataError('invalid_request','Templates changed. Restart the list.');
    const start = page?.offset ?? 0;
    return TEMPLATE_OUTPUTS[tool].parse({ templates: items.slice(start,start+25).map(item => project(input,item)), nextCursor: items.length > start+25
      ? encode(input, { kind: 'template-page', source: args.source, digest, offset: start+25, expires: Date.now()+900000 }) : null });
  }
  if (tool === 'get_training_plan_template') {
    const args = TEMPLATE_INPUTS[tool].parse(input.arguments), ref = templateRef.parse(decode(input,args.templateRef));
    const item = await getTemplate(access(input,false),ref.source,ref.id);
    if (item.version !== ref.version) throw new McpDataError('invalid_request','Read the current template edition.');
    let end = Math.min(args.offset+7,item.sessions.length);
    while (end > args.offset+1 && Buffer.byteLength(JSON.stringify(item.sessions.slice(args.offset,end))) > 45000) end--;
    if (Buffer.byteLength(JSON.stringify(item.sessions.slice(args.offset,end))) > 55000) throw new McpDataError('detail_not_available','This prescription exceeds the single-response limit.');
    return TEMPLATE_OUTPUTS[tool].parse({ template: project(input,summarizeTemplate(item)), sessions: item.sessions.slice(args.offset,end),
      phases: item.phases.map(({ name, start, end, description }) => ({ name, start, end, ...(description ? { description } : {}) })), rest: item.rest, nextOffset: end < item.sessions.length ? end : null });
  }
  if (tool === 'preview_training_plan_enrollment') {
    const args = TEMPLATE_INPUTS[tool].parse(input.arguments), ref = templateRef.parse(decode(input,args.templateRef));
    const { anchor, date, longDay, pattern } = args;
    const options = scheduleOptions.parse({ anchor, date,
      longDay: longDay ?? (anchor === 'finish' ? new Date(date + 'T12:00:00Z').getUTCDay() : 0), pattern: pattern ?? 'standard' });
    const review = await previewEnrollment(access(input,true), ref.source,ref.id,ref.version,options);
    const workoutCounts = new Map<string, number>();
    for (const date of review.dates) workoutCounts.set(date, (workoutCounts.get(date) ?? 0) + 1);
    const rest = new Set(review.restDays), overlaps = new Set(review.conflicts);
    const days = [...new Set([...workoutCounts.keys(), ...rest])].sort().map(date => {
      const count = workoutCounts.get(date);
      return date + (count ? (count > 1 ? ' ×' + count : '') : ' rest') + (overlaps.has(date) ? ' overlap' : '');
    });
    const chunks: string[] = [];
    for (let i = 0; i < days.length; i += 18) chunks.push(days.slice(i, i + 18).join(', '));
    return TEMPLATE_OUTPUTS[tool].parse({ proposalRef: encode(input,{ kind:'plan-enrollment',id:review.id },true),
      permissionMode: 'schedule', scheduleRevision: review.scheduleRevision, expiresAtMs: review.expiresAtMs, requiresConfirmation:true,
      summary: `Add “${review.name}” as paused, ${review.start} through ${review.end}. ${review.dates.length} workouts, ${review.restDays.length} rest days, ${review.conflicts.length} overlapping dates. Device sync stays off.` +
        (review.scheduleMode === 'fixed' ? ' Workout spacing follows the template.' : '') +
        (review.attribution ? ` Original by ${review.attribution.originalAuthor} (${review.attribution.license}).` : ''),
      changes: chunks.map((summary,index) => ({ index,kind:'enroll-plan',summary })), providerPreviews:[] });
  }
  const args = TEMPLATE_INPUTS.apply_training_plan_enrollment.parse(input.arguments), ref = proposalRef.parse(decode(input,args.proposalRef,true));
  const result = await applyEnrollment(access(input,true,args.proposalRef),ref.id);
  return TEMPLATE_OUTPUTS.apply_training_plan_enrollment.parse({ status:'applied', lifecycle:'paused', scheduleRevision:result.scheduleRevision,
    planRef: encode(input,{ kind:'plan',id:result.planId,createdAtMs:result.createdAtMs }) });
}
