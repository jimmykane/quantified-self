import * as path from 'path';
import { readFileSync } from 'fs';
import * as admin from 'firebase-admin';

import { normalizeInsightQuery } from '../src/ai/insights/normalize-query.flow';
import { executeAiInsightsQuery } from '../src/ai/insights/execute-query';

const uid = 'xcsAolLDDTWTgtRN9eYF3lW2YKL2';
const clientTimezone = 'Europe/Helsinki';

const prompts = [
  'Estimate my current achievable max heart rate this year for cycling with confidence and evidence.',
  'Estimate my potential max heart rate this year for cycling with confidence and evidence.',
  'Estimate my current achievable max heart rate for cycling in 2025 with confidence and evidence.',
  'Estimate my potential max heart rate for cycling in 2025 with confidence and evidence.',
  'Estimate my current achievable max heart rate for cycling in 2024 with confidence and evidence.',
  'Estimate my potential max heart rate for cycling in 2024 with confidence and evidence.',
  'Estimate my current achievable max heart rate for cycling in 2023 with confidence and evidence.',
  'Estimate my potential max heart rate for cycling in 2023 with confidence and evidence.',
  'What should my max heart rate be this year for cycling?',
  'What is my current achievable max heart rate this year based on my cycling workouts?',
];

function initAdmin(): void {
  if (admin.apps.length > 0) {
    return;
  }

  const serviceAccountPath = path.resolve('/Users/dimitrios/Projects/quantified-self/quantified-self-io-firebase-adminsdk.json');

  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as admin.ServiceAccount;
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function run(): Promise<void> {
  initAdmin();

  for (const prompt of prompts) {
    const normalized = await normalizeInsightQuery({
      prompt,
      clientTimezone,
    });

    console.log('\n=== ' + prompt + ' ===');

    if (normalized.status !== 'ok') {
      console.log(JSON.stringify({
        normalizedStatus: normalized.status,
        reasonCode: normalized.reasonCode,
        suggestedPrompts: normalized.suggestedPrompts,
      }, null, 2));
      continue;
    }

    console.log(JSON.stringify({
      normalizedResultKind: normalized.query.resultKind,
      metricKey: normalized.metricKey ?? null,
      advisoryKind: normalized.query.resultKind === 'advisory' ? normalized.query.advisoryKind : null,
      dateRange: normalized.query.dateRange,
      activityTypesCount: normalized.query.activityTypes.length,
    }, null, 2));

    if (normalized.query.resultKind !== 'advisory') {
      continue;
    }

    const execution = await executeAiInsightsQuery(uid, normalized.query, prompt);
    if (execution.resultKind !== 'advisory') {
      console.log(JSON.stringify({
        executionResultKind: execution.resultKind,
      }, null, 2));
      continue;
    }

    const advisory = execution.advisory;
    console.log(JSON.stringify({
      advisoryStatus: advisory.status,
      semanticKind: advisory.semanticKind,
      estimate: advisory.estimate,
      interval: advisory.interval,
      confidence: advisory.confidence,
      observed: advisory.observed,
      insufficientData: advisory.insufficientData ?? null,
      topEvidence: advisory.evidence.slice(0, 6),
    }, null, 2));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
