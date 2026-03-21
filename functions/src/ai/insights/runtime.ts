import type {
  AiInsightsRequest,
  AiInsightsUnsupportedReasonCode,
} from '../../../../shared/ai-insights.types';
import {
  createExecuteQuery,
  type ExecuteQueryDependencies,
  type ExecuteQueryApi,
} from './execute-query';
import {
  createNormalizeQuery,
  type NormalizeQueryDependencies,
  type NormalizeQueryApi,
} from './normalize-query.flow';
import {
  createRepairInsightQuery,
  type RepairInsightQueryDependencies,
  type RepairInsightQueryResult,
} from './normalize-query.repair';
import {
  createPromptLanguageSanitization,
  detectPromptLanguageDeterministic,
  type PromptLanguageSanitizationApi,
} from './prompt-language-sanitization';
import {
  createAiInsightsPromptRepairBacklog,
  type AiInsightsPromptRepairBacklogApi,
  type AiInsightsPromptRepairBacklogDependencies,
} from './repaired-prompt-backlog';
import {
  AI_INSIGHTS_LIMIT_REACHED_MESSAGE,
  createAiInsightsQuota,
  type AiInsightsQuotaApi,
  type AiInsightsQuotaDependencies,
  type AiInsightsUserRoleContext,
} from './quota';
import {
  createSummarizeInsight,
  type SummarizeInsightApi,
  type SummarizeInsightDependencies,
} from './summarize-result.flow';
import {
  createLoadUserUnitSettings,
  type LoadUserUnitSettingsApi,
  type LoadUserUnitSettingsDependencies,
} from './user-unit-settings';

interface AiInsightsRuntimeDependencies {
  normalizeQuery?: Partial<NormalizeQueryDependencies>;
  executeQuery?: Partial<ExecuteQueryDependencies>;
  repairInsightQuery?: Partial<RepairInsightQueryDependencies>;
  promptLanguageSanitization?: Parameters<typeof createPromptLanguageSanitization>[0];
  promptRepairBacklog?: Partial<AiInsightsPromptRepairBacklogDependencies>;
  quota?: Partial<AiInsightsQuotaDependencies>;
  summarizeInsight?: Partial<SummarizeInsightDependencies>;
  loadUserUnitSettings?: Partial<LoadUserUnitSettingsDependencies>;
}

interface RepairUnsupportedResult {
  status: 'unsupported';
  reasonCode: AiInsightsUnsupportedReasonCode;
  suggestedPrompts: string[];
}

export interface AiInsightsRuntime {
  normalizeInsightQuery: NormalizeQueryApi['normalizeInsightQuery'];
  repairUnsupportedInsightQuery: (
    input: AiInsightsRequest,
    deterministicResult: RepairUnsupportedResult,
  ) => Promise<RepairInsightQueryResult>;
  detectPromptLanguageDeterministic: typeof detectPromptLanguageDeterministic;
  sanitizePromptToEnglish: PromptLanguageSanitizationApi['sanitizePromptToEnglish'];
  buildAiInsightsPromptRepairIdentity: AiInsightsPromptRepairBacklogApi['buildAiInsightsPromptRepairIdentity'];
  recordSuccessfulAiInsightRepair: AiInsightsPromptRepairBacklogApi['recordSuccessfulAiInsightRepair'];
  getAiInsightsQuotaStatus: AiInsightsQuotaApi['getAiInsightsQuotaStatus'];
  reserveAiInsightsQuotaForRequest: AiInsightsQuotaApi['reserveAiInsightsQuotaForRequest'];
  finalizeAiInsightsQuotaReservation: AiInsightsQuotaApi['finalizeAiInsightsQuotaReservation'];
  releaseAiInsightsQuotaReservation: AiInsightsQuotaApi['releaseAiInsightsQuotaReservation'];
  executeAiInsightsQuery: ExecuteQueryApi['executeAiInsightsQuery'];
  summarizeAiInsightResult: SummarizeInsightApi['summarizeAiInsightResult'];
  loadUserUnitSettings: LoadUserUnitSettingsApi['loadUserUnitSettings'];
}

export function createAiInsightsRuntime(
  dependencies: AiInsightsRuntimeDependencies = {},
): AiInsightsRuntime {
  const normalizeQuery = createNormalizeQuery(dependencies.normalizeQuery);
  const executeQuery = createExecuteQuery(dependencies.executeQuery);
  const repairInsightQuery = createRepairInsightQuery(dependencies.repairInsightQuery);
  const promptLanguageSanitization = createPromptLanguageSanitization(dependencies.promptLanguageSanitization);
  const promptRepairBacklog = createAiInsightsPromptRepairBacklog(dependencies.promptRepairBacklog);
  const quota = createAiInsightsQuota(dependencies.quota);
  const summarizeInsight = createSummarizeInsight(dependencies.summarizeInsight);
  const loadUserUnitSettings = createLoadUserUnitSettings(dependencies.loadUserUnitSettings);

  return {
    normalizeInsightQuery: normalizeQuery.normalizeInsightQuery,
    repairUnsupportedInsightQuery: repairInsightQuery.repairUnsupportedInsightQuery,
    detectPromptLanguageDeterministic,
    sanitizePromptToEnglish: promptLanguageSanitization.sanitizePromptToEnglish,
    buildAiInsightsPromptRepairIdentity: promptRepairBacklog.buildAiInsightsPromptRepairIdentity,
    recordSuccessfulAiInsightRepair: promptRepairBacklog.recordSuccessfulAiInsightRepair,
    getAiInsightsQuotaStatus: quota.getAiInsightsQuotaStatus,
    reserveAiInsightsQuotaForRequest: quota.reserveAiInsightsQuotaForRequest,
    finalizeAiInsightsQuotaReservation: quota.finalizeAiInsightsQuotaReservation,
    releaseAiInsightsQuotaReservation: quota.releaseAiInsightsQuotaReservation,
    executeAiInsightsQuery: executeQuery.executeAiInsightsQuery,
    summarizeAiInsightResult: summarizeInsight.summarizeAiInsightResult,
    loadUserUnitSettings: loadUserUnitSettings.loadUserUnitSettings,
  };
}

export const aiInsightsRuntime = createAiInsightsRuntime();

export {
  AI_INSIGHTS_LIMIT_REACHED_MESSAGE,
  type AiInsightsUserRoleContext,
};
