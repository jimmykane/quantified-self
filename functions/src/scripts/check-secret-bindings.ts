import { validateFunctionSecretBindings } from '../secret-bindings-check';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

process.env.GCLOUD_PROJECT ||= 'secret-bindings-check';
process.env.FIREBASE_CONFIG ||= JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });

// Runtime require is intentional: the environment needed by legacy v1 Auth
// endpoint metadata must be established before the Functions index is loaded.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const functionExports = require('../index') as Record<string, unknown>;
const violations = validateFunctionSecretBindings(functionExports, FUNCTION_SECRET_BINDINGS);

if (violations.length > 0) {
  console.error('Function Secret Manager binding check failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Function Secret Manager binding check passed for ${Object.keys(FUNCTION_SECRET_BINDINGS).length} secret-bound endpoints.`);
}
