import type {
  AssistantEvidence,
  AssistantEvidenceFact,
  AssistantEvidenceLink,
} from '../../../shared/assistant.types';
import { normalizeAssistantEvidenceFact } from '../../../shared/assistant-evidence-display';
import type {
  AssistantMcpToolDefinition,
  AssistantMcpToolName,
} from './mcp-session';
import { isFunctionsEmulator } from '../utils';

const MAX_FACTS = 6;
const MAX_LINKS = 3;
const MAX_WALK_DEPTH = 4;
const SAFE_APP_ORIGINS = new Set([
  'https://quantified-self.io',
  'https://www.quantified-self.io',
  'https://beta.quantified-self.io',
]);
const DENIED_FIELD_PATTERN = /(?:^|_)(?:uid|user|owner|email|token|secret|source|provider|device|cursor|ref|id|lat|latitude|lng|lon|longitude|gps|location|coordinates?|position|geometry|polyline|waypoints?|bounds|bbox|center)(?:$|_)/i;
const SUMMARY_ARRAY_KEYS = [
  'activities',
  'routes',
  'sessions',
  'measurements',
  'buckets',
  'values',
  'metricResults',
  'metrics',
  'days',
  'items',
] as const;

function isDeniedField(key: string): boolean {
  const normalizedKey = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_');
  return DENIED_FIELD_PATTERN.test(normalizedKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function humanizeFieldName(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced
    ? `${spaced[0].toUpperCase()}${spaced.slice(1)}`
    : 'Value';
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatDurationSeconds(value: number): string {
  const roundedSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(roundedSeconds / 3_600);
  const minutes = Math.floor((roundedSeconds % 3_600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${roundedSeconds}s`;
}

function isDurationSecondsField(key: string): boolean {
  return /(?:duration|sleep).*seconds$/i.test(key);
}

function isTimestampMillisecondsField(key: string): boolean {
  return /(?:time|date|day|at)ms$/i.test(key);
}

function formatFactValue(key: string, value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    if (isDurationSecondsField(key)) {
      return formatDurationSeconds(value);
    }
    if (isTimestampMillisecondsField(key) && value > 0) {
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) {
        return date.toISOString();
      }
    }
    return Number.isInteger(value)
      ? `${value}`
      : `${Math.round(value * 100) / 100}`;
  }
  return truncate(value, 160);
}

function collectFacts(
  value: unknown,
  facts: AssistantEvidenceFact[],
  seenLabels: Set<string>,
  depth = 0,
): void {
  if (facts.length >= MAX_FACTS || depth > MAX_WALK_DEPTH) {
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      collectFacts(child, facts, seenLabels, depth + 1);
      if (facts.length >= MAX_FACTS) {
        return;
      }
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (facts.length >= MAX_FACTS) {
      return;
    }
    if (key === 'appUrl' || isDeniedField(key)) {
      continue;
    }
    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
      const formattedValue = formatFactValue(key, child);
      const fact = normalizeAssistantEvidenceFact({
        label: humanizeFieldName(key),
        value: formattedValue,
      });
      const { label } = fact;
      if (formattedValue && !seenLabels.has(label)) {
        facts.push(fact);
        seenLabels.add(label);
      }
      continue;
    }
    if (Array.isArray(child) || isRecord(child)) {
      collectFacts(child, facts, seenLabels, depth + 1);
    }
  }
}

function buildRankingFacts(
  structuredContent: Record<string, unknown>,
): AssistantEvidenceFact[] | null {
  const activities = structuredContent.activities;
  const metric = structuredContent.metric;
  if (!Array.isArray(activities)
    || activities.length === 0
    || !isRecord(activities[0])
    || !isRecord(metric)) {
    return null;
  }
  const topActivity = activities[0];
  const startTime = topActivity.startTime;
  const activityType = topActivity.activityType;
  const value = topActivity.value;
  const rank = topActivity.rank;
  const unit = metric.unit;
  const scannedActivityCount = structuredContent.scannedActivityCount;
  if (typeof startTime !== 'string'
    || !Number.isFinite(Date.parse(startTime))
    || typeof value !== 'number'
    || !Number.isFinite(value)) {
    return null;
  }
  const facts: AssistantEvidenceFact[] = [];
  const addFact = (label: string, factValue: string | number): void => {
    facts.push(normalizeAssistantEvidenceFact({
      label,
      value: typeof factValue === 'number'
        ? formatFactValue(label, factValue)
        : truncate(factValue, 160),
    }));
  };
  if (typeof activityType === 'string' && activityType.trim()) {
    addFact('Activity Type', activityType);
  }
  const formattedValue = formatFactValue('value', value);
  addFact(
    'Value',
    typeof unit === 'string' && unit.trim()
      ? `${formattedValue} ${truncate(unit, 20)}`
      : formattedValue,
  );
  addFact('Start Time', startTime);
  if (typeof rank === 'number' && Number.isSafeInteger(rank) && rank > 0) {
    addFact('Rank', rank);
  }
  if (typeof scannedActivityCount === 'number'
    && Number.isSafeInteger(scannedActivityCount)
    && scannedActivityCount >= 0) {
    addFact('Scanned Activity Count', scannedActivityCount);
  }
  return facts.slice(0, MAX_FACTS);
}

function parseSafeAppUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) {
    return null;
  }
  try {
    const url = new URL(value);
    const isAllowedLoopback = isFunctionsEmulator()
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      && (url.protocol === 'http:' || url.protocol === 'https:')
      && !!url.port;
    if ((!SAFE_APP_ORIGINS.has(url.origin) && !isAllowedLoopback)
      || url.username
      || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function collectLinks(
  value: unknown,
  links: AssistantEvidenceLink[],
  seenUrls: Set<string>,
  depth = 0,
): void {
  if (links.length >= MAX_LINKS || depth > MAX_WALK_DEPTH) {
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      collectLinks(child, links, seenUrls, depth + 1);
      if (links.length >= MAX_LINKS) {
        return;
      }
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'appUrl') {
      const safeUrl = parseSafeAppUrl(child);
      if (safeUrl && !seenUrls.has(safeUrl)) {
        links.push({ label: 'Open in Quantified Self', url: safeUrl });
        seenUrls.add(safeUrl);
      }
      continue;
    }
    if (isDeniedField(key)) {
      continue;
    }
    collectLinks(child, links, seenUrls, depth + 1);
    if (links.length >= MAX_LINKS) {
      return;
    }
  }
}

function buildSummary(toolTitle: string, output: Record<string, unknown>): string {
  for (const key of SUMMARY_ARRAY_KEYS) {
    const items = output[key];
    if (Array.isArray(items)) {
      const itemLabel = humanizeFieldName(key).toLocaleLowerCase();
      return `${items.length} ${itemLabel} returned by ${toolTitle}.`;
    }
  }
  const countEntry = Object.entries(output)
    .find(([key, value]) => /count$/i.test(key)
      && !isDeniedField(key)
      && typeof value === 'number');
  if (countEntry) {
    return `${humanizeFieldName(countEntry[0])}: ${countEntry[1]}.`;
  }
  return `Grounded in ${toolTitle}.`;
}

export function buildAssistantEvidence(
  tool: Pick<AssistantMcpToolDefinition, 'name' | 'title'>,
  structuredContent: Record<string, unknown>,
): AssistantEvidence {
  const facts = tool.name === 'rank_activities_by_metric'
    ? buildRankingFacts(structuredContent) || []
    : [];
  const links: AssistantEvidenceLink[] = [];
  if (facts.length === 0) {
    collectFacts(structuredContent, facts, new Set<string>());
  }
  collectLinks(structuredContent, links, new Set<string>());
  return {
    toolName: tool.name,
    title: truncate(tool.title, 160),
    summary: truncate(buildSummary(tool.title, structuredContent), 300),
    facts,
    links,
  };
}

export interface AssistantToolInvocation {
  name: AssistantMcpToolName;
  structuredContent: Record<string, unknown>;
}

export function buildAssistantEvidenceList(
  tools: readonly AssistantMcpToolDefinition[],
  invocations: readonly AssistantToolInvocation[],
): AssistantEvidence[] {
  const toolsByName = new Map(tools.map(tool => [tool.name, tool]));
  return invocations.slice(-6).flatMap((invocation) => {
    const tool = toolsByName.get(invocation.name);
    return tool
      ? [buildAssistantEvidence(tool, invocation.structuredContent)]
      : [];
  });
}
