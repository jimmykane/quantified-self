import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import type {
  AiInsightsUnsupportedReasonCode,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { TTL_CONFIG } from '../../shared/ttl-config';
import { canonicalizeInsightPrompt } from './prompt-normalization';

const AI_INSIGHTS_PROMPT_REPAIRS_COLLECTION = 'aiInsightsPromptRepairs';
const AI_INSIGHTS_PROMPT_REPAIR_BACKLOG_VERSION = 1;
const AI_INSIGHTS_PROMPT_REPAIR_RAW_PROMPT_MAX_CHARS = 1000;
const AI_INSIGHTS_PROMPT_REPAIR_TTL_MS = TTL_CONFIG.AI_INSIGHTS_PROMPT_REPAIRS_IN_DAYS * 24 * 60 * 60 * 1000;

export interface AiInsightsPromptRepairIdentity {
  canonicalPrompt: string;
  normalizedQuerySignature: string;
  intentDocID: string;
}

export interface RecordSuccessfulAiInsightRepairInput {
  rawPrompt: string;
  repairInputPrompt: string;
  normalizedQuery: NormalizedInsightQuery;
  deterministicFailureReasonCode: AiInsightsUnsupportedReasonCode;
  metricKey?: string;
}

export interface AiInsightsPromptRepairBacklogDependencies {
  now: () => Date;
  db: () => FirebaseFirestore.Firestore;
  canonicalizePrompt: (prompt: string) => string;
  hashText: (text: string) => string;
}

export interface AiInsightsPromptRepairBacklogApi {
  buildAiInsightsPromptRepairIdentity: (
    repairInputPrompt: string,
    normalizedQuery: NormalizedInsightQuery,
  ) => AiInsightsPromptRepairIdentity;
  recordSuccessfulAiInsightRepair: (
    input: RecordSuccessfulAiInsightRepairInput,
  ) => Promise<AiInsightsPromptRepairIdentity>;
}

const defaultAiInsightsPromptRepairBacklogDependencies: AiInsightsPromptRepairBacklogDependencies = {
  now: () => new Date(),
  db: () => admin.firestore(),
  canonicalizePrompt: canonicalizeInsightPrompt,
  hashText: (text: string) => createHash('sha256').update(text).digest('hex'),
};

export function trimPromptSample(prompt: string, maxChars = AI_INSIGHTS_PROMPT_REPAIR_RAW_PROMPT_MAX_CHARS): string {
  return `${prompt || ''}`
    .trim()
    .slice(0, Math.max(0, maxChars));
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(entry => stableSerialize(entry)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort((left, right) => left.localeCompare(right));
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`).join(',')}}`;
}

export function buildNormalizedInsightQuerySignature(
  normalizedQuery: NormalizedInsightQuery,
): string {
  return stableSerialize(normalizedQuery);
}

export function createAiInsightsPromptRepairBacklog(
  dependencies: Partial<AiInsightsPromptRepairBacklogDependencies> = {},
): AiInsightsPromptRepairBacklogApi {
  const resolvedDependencies: AiInsightsPromptRepairBacklogDependencies = {
    ...defaultAiInsightsPromptRepairBacklogDependencies,
    ...dependencies,
  };

  const buildAiInsightsPromptRepairIdentity = (
    repairInputPrompt: string,
    normalizedQuery: NormalizedInsightQuery,
  ): AiInsightsPromptRepairIdentity => {
    const canonicalPrompt = resolvedDependencies.canonicalizePrompt(repairInputPrompt);
    const normalizedQuerySignature = buildNormalizedInsightQuerySignature(normalizedQuery);
    const intentDocID = resolvedDependencies.hashText(
      `${canonicalPrompt}\n${normalizedQuerySignature}`,
    );

    return {
      canonicalPrompt,
      normalizedQuerySignature,
      intentDocID,
    };
  };

  const recordSuccessfulAiInsightRepair = async (
    input: RecordSuccessfulAiInsightRepairInput,
  ): Promise<AiInsightsPromptRepairIdentity> => {
    const identity = buildAiInsightsPromptRepairIdentity(input.repairInputPrompt, input.normalizedQuery);
    const docRef = resolvedDependencies.db()
      .collection(AI_INSIGHTS_PROMPT_REPAIRS_COLLECTION)
      .doc(identity.intentDocID);

    await resolvedDependencies.db().runTransaction(async (transaction) => {
      const now = resolvedDependencies.now();
      const nowIso = now.toISOString();
      const nowMs = now.getTime();
      const expireAt = new Date(nowMs + AI_INSIGHTS_PROMPT_REPAIR_TTL_MS);
      const snapshot = await transaction.get(docRef);
      const existingData = snapshot.data() as Record<string, unknown> | undefined;
      const existingSeenCount = typeof existingData?.seenCount === 'number'
        ? Math.max(0, Math.floor(existingData.seenCount))
        : 0;
      const existingFirstSeenAt = typeof existingData?.firstSeenAt === 'string'
        ? existingData.firstSeenAt
        : nowIso;
      const existingTriageStatus = typeof existingData?.triageStatus === 'string'
        ? existingData.triageStatus
        : 'pending';

      const commonPayload = {
        version: AI_INSIGHTS_PROMPT_REPAIR_BACKLOG_VERSION,
        canonicalPrompt: identity.canonicalPrompt,
        normalizedQuerySignature: identity.normalizedQuerySignature,
        normalizedQuery: input.normalizedQuery,
        metricKey: input.metricKey ?? null,
        deterministicFailureReasonCode: input.deterministicFailureReasonCode,
        lastSeenAt: nowIso,
        latestRawPrompt: trimPromptSample(input.rawPrompt),
        latestRepairInputPrompt: trimPromptSample(input.repairInputPrompt),
        source: 'repair_genkit_success',
        triageStatus: existingTriageStatus,
        expireAt,
        updatedAt: nowIso,
      };

      if (snapshot.exists) {
        transaction.update(docRef, {
          ...commonPayload,
          seenCount: existingSeenCount + 1,
        });
        return;
      }

      transaction.create(docRef, {
        ...commonPayload,
        seenCount: 1,
        firstSeenAt: existingFirstSeenAt,
      });
    });

    return identity;
  };

  return {
    buildAiInsightsPromptRepairIdentity,
    recordSuccessfulAiInsightRepair,
  };
}

export async function withAiInsightsPromptRepairBacklogDependenciesForTesting<T>(
  dependencies: Partial<AiInsightsPromptRepairBacklogDependencies>,
  run: (api: AiInsightsPromptRepairBacklogApi) => Promise<T> | T,
): Promise<T> {
  return run(createAiInsightsPromptRepairBacklog(dependencies));
}

const aiInsightsPromptRepairBacklogRuntime = createAiInsightsPromptRepairBacklog();

export function buildAiInsightsPromptRepairIdentity(
  repairInputPrompt: string,
  normalizedQuery: NormalizedInsightQuery,
): AiInsightsPromptRepairIdentity {
  return aiInsightsPromptRepairBacklogRuntime.buildAiInsightsPromptRepairIdentity(
    repairInputPrompt,
    normalizedQuery,
  );
}

export async function recordSuccessfulAiInsightRepair(
  input: RecordSuccessfulAiInsightRepairInput,
): Promise<AiInsightsPromptRepairIdentity> {
  return aiInsightsPromptRepairBacklogRuntime.recordSuccessfulAiInsightRepair(input);
}
