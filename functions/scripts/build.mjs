import { spawn } from 'node:child_process';
import console from 'node:console';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const functionsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildOutputDirectory = path.join(functionsDirectory, 'lib');
const typescriptCliPath = path.join(functionsDirectory, 'node_modules', 'typescript', 'bin', 'tsc');

async function runTypeScriptCompiler() {
  const child = spawn(process.execPath, [typescriptCliPath], {
    cwd: functionsDirectory,
    env: process.env,
    stdio: 'inherit',
  });

  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`TypeScript failed${signal ? ` with ${signal}` : ` with exit code ${code ?? 'unknown'}`}.`));
    });
  });
}

try {
  await rm(buildOutputDirectory, { recursive: true, force: true });
  await runTypeScriptCompiler();
} catch (error) {
  console.error(`[functions-build] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
