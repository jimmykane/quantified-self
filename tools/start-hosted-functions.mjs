import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { buildLocalNodeCommand, repositoryRoot } from './local-runtime.mjs';

const requiredConfirmation = 'quantified-self-io';
if (process.env.QS_ALLOW_HOSTED_FUNCTIONS !== requiredConfirmation) {
  console.error(`[hosted-functions] Refusing to use hosted Firebase resources. Set QS_ALLOW_HOSTED_FUNCTIONS=${requiredConfirmation} only for an intentional maintainer workflow.`);
  process.exitCode = 1;
} else {
  console.warn('[hosted-functions] Explicit opt-in accepted. Browser calls may reach hosted Firebase resources.');
  const invocation = buildLocalNodeCommand('ng', [
    'serve',
    '--configuration', 'local-prod-functions',
    '--port', '4200',
  ]);
  const child = spawn(invocation.command, invocation.args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  const [code] = await once(child, 'exit');
  process.exitCode = typeof code === 'number' ? code : 1;
}
