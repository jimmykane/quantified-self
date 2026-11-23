import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import { assistantPrivateTemplateAccess, applyEnrollment, getTemplate, listTemplates, ownerAccess, readPlanAttribution, previewEnrollment, savePrivateTemplate, scheduleOptions, sourceSchema, templateId } from './plan-templates';
import { TrainingScheduleMutationError } from './mutation';

const input = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('assistant-access'), conversationId: z.string().min(1).max(120), enabled: z.boolean().optional() }),
  z.strictObject({ action: z.literal('list'), source: sourceSchema }),
  z.strictObject({ action: z.literal('get'), source: sourceSchema, id: templateId }),
  z.strictObject({ action: z.literal('attribution'), planId: templateId, createdAtMs: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal('save'), planId: templateId, revision: z.number().int().positive() }),
  z.strictObject({ action: z.literal('preview'), source: sourceSchema, id: templateId, version: z.number().int().positive(), options: scheduleOptions }),
  z.strictObject({ action: z.literal('apply'), proposalId: templateId }),
]);
export const trainingPlanTemplates = onCall({ region: FUNCTIONS_MANIFEST.trainingPlanTemplates.region, memory: '512MiB', timeoutSeconds: 120 }, async req => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to use plan templates.');
  enforceAppCheck(req);
  const parsed = input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid template request.');
  const args = parsed.data, access = ownerAccess(req.auth.uid);
  try {
    switch (args.action) {
      case 'assistant-access': return { enabled: await assistantPrivateTemplateAccess(access.uid,args.conversationId,args.enabled) };
      case 'list': return await listTemplates(access, args.source);
      case 'get': return await getTemplate(access, args.source, args.id);
      case 'attribution': return await readPlanAttribution(access, args.planId, args.createdAtMs);
      case 'save': return await savePrivateTemplate(access.uid, args.planId, args.revision);
      case 'preview': return await previewEnrollment(access, args.source, args.id, args.version, args.options);
      case 'apply': return await applyEnrollment(access, args.proposalId);
    }
  } catch (error) {
    if (error instanceof TrainingScheduleMutationError) throw new HttpsError('failed-precondition', error.message);
    throw error;
  }
});
