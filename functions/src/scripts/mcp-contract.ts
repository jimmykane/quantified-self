import {
  access,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createEmptyMcpContractHistory,
  captureMcpContract,
  createRegisteredMcpContract,
  digestMcpContract,
  evaluateMcpContractBaselineTransition,
  evaluateMcpContractGate,
  isCompletedMcpContractPromotion,
  McpContractChangeRecord,
  McpContractFinding,
  McpContractHistory,
  normalizeMcpContractJson,
  parseMcpContractChangeRecord,
  parseMcpContractHistory,
  parseRegisteredMcpContract,
  prepareMcpContractPromotionHistory,
  RegisteredMcpContract,
} from '../mcp/contract-compatibility';

const execFileAsync = promisify(execFile);
const FUNCTIONS_ROOT = process.cwd();
const REPOSITORY_ROOT = path.resolve(FUNCTIONS_ROOT, '..');
const CONTRACT_DIRECTORY = path.resolve(
  FUNCTIONS_ROOT,
  'src/mcp/contracts',
);
const REGISTERED_CONTRACT_PATH = path.join(
  CONTRACT_DIRECTORY,
  'registered-contract.json',
);
const PENDING_CHANGE_PATH = path.join(
  CONTRACT_DIRECTORY,
  'pending-change.json',
);
const CONTRACT_HISTORY_PATH = path.join(
  CONTRACT_DIRECTORY,
  'contract-history.json',
);
const REGISTERED_CONTRACT_REPOSITORY_PATH =
  'functions/src/mcp/contracts/registered-contract.json';
const CONTRACT_HISTORY_REPOSITORY_PATH =
  'functions/src/mcp/contracts/contract-history.json';
const GIT_SHA_PATTERN = /^[a-f0-9]{7,64}$/i;
const ZERO_GIT_SHA_PATTERN = /^0+$/;
const GIT_JSON_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

function comparableFilePath(filePath: string): string {
  return path.normalize(filePath).toLowerCase();
}

function argumentValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error
    && 'code' in error
    && error.code === 'ENOENT'
  );
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function readRegisteredContract(): Promise<RegisteredMcpContract> {
  return parseRegisteredMcpContract(
    await readJsonFile(REGISTERED_CONTRACT_PATH),
  );
}

async function readContractHistory(): Promise<McpContractHistory> {
  return parseMcpContractHistory(
    await readJsonFile(CONTRACT_HISTORY_PATH),
  );
}

async function readPendingChange(): Promise<McpContractChangeRecord | null> {
  try {
    return parseMcpContractChangeRecord(
      await readJsonFile(PENDING_CHANGE_PATH),
    );
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

async function writeJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const normalized = normalizeMcpContractJson(value);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function previousRevision(): string {
  const configured = process.env.MCP_CONTRACT_PREVIOUS_REVISION?.trim();
  if (!configured || ZERO_GIT_SHA_PATTERN.test(configured)) {
    return 'HEAD';
  }
  if (!GIT_SHA_PATTERN.test(configured)) {
    throw new Error(
      'MCP_CONTRACT_PREVIOUS_REVISION must be a hexadecimal Git commit SHA.',
    );
  }
  return configured;
}

async function readJsonAtRevision(
  revision: string,
  repositoryPath: string,
): Promise<unknown | null> {
  try {
    await execFileAsync(
      'git',
      ['cat-file', '-e', `${revision}^{commit}`],
      { cwd: REPOSITORY_ROOT },
    );
  } catch {
    throw new Error(
      `The previous MCP contract revision ${revision} is unavailable.`,
    );
  }
  try {
    await execFileAsync(
      'git',
      ['cat-file', '-e', `${revision}:${repositoryPath}`],
      { cwd: REPOSITORY_ROOT },
    );
  } catch {
    return null;
  }
  const result = await execFileAsync(
    'git',
    ['show', `${revision}:${repositoryPath}`],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      maxBuffer: GIT_JSON_MAX_BUFFER_BYTES,
    },
  );
  return JSON.parse(String(result.stdout)) as unknown;
}

async function verifyBaselineTransition(
  registered: RegisteredMcpContract,
  history: McpContractHistory,
): Promise<void> {
  const revision = previousRevision();
  const previousRegisteredValue = await readJsonAtRevision(
    revision,
    REGISTERED_CONTRACT_REPOSITORY_PATH,
  );
  const previousHistoryValue = await readJsonAtRevision(
    revision,
    CONTRACT_HISTORY_REPOSITORY_PATH,
  );
  const evaluation = evaluateMcpContractBaselineTransition(
    previousRegisteredValue
      ? parseRegisteredMcpContract(previousRegisteredValue)
      : null,
    registered,
    previousHistoryValue
      ? parseMcpContractHistory(previousHistoryValue)
      : null,
    history,
  );
  if (evaluation.errors.length > 0) {
    throw new Error(evaluation.errors.join(' '));
  }
}

function printFindings(
  label: string,
  findings: McpContractFinding[],
): void {
  if (findings.length === 0) {
    return;
  }
  console.error(`${label}:`);
  for (const finding of findings) {
    console.error(`- ${finding.path}: ${finding.message}`);
  }
}

async function checkContract(): Promise<void> {
  const registered = await readRegisteredContract();
  const history = await readContractHistory();
  await verifyBaselineTransition(registered, history);
  const pending = await readPendingChange();
  const candidate = await captureMcpContract(registered.contract.origin);
  const evaluation = evaluateMcpContractGate(
    registered,
    candidate,
    pending,
  );

  printFindings(
    'Breaking MCP contract changes',
    evaluation.comparison.breaking,
  );
  printFindings(
    'MCP metadata changes requiring refresh or publication',
    evaluation.comparison.releaseRequired,
  );
  if (
    evaluation.comparison.breaking.length > 0
    || evaluation.comparison.releaseRequired.length > 0
  ) {
    console.error(
      `Candidate MCP contract SHA-256: ${evaluation.candidateSha256}`,
    );
  }
  for (const error of evaluation.errors) {
    console.error(`- ${error}`);
  }
  if (evaluation.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (evaluation.pendingActionRequired && pending) {
    console.log(
      `MCP contract is compatible and awaits ${pending.lifecycleAction} (${evaluation.candidateSha256}).`,
    );
    return;
  }
  console.log(
    `MCP contract matches the registered ${registered.lifecycle} baseline (${evaluation.candidateSha256}).`,
  );
}

async function captureContract(): Promise<void> {
  const outputArgument = argumentValue('--output');
  if (!outputArgument) {
    throw new Error('capture requires --output <path>.');
  }
  const outputPath = path.resolve(FUNCTIONS_ROOT, outputArgument);
  const protectedPaths = new Set([
    REGISTERED_CONTRACT_PATH,
    PENDING_CHANGE_PATH,
    CONTRACT_HISTORY_PATH,
  ].map(comparableFilePath));
  if (protectedPaths.has(comparableFilePath(outputPath))) {
    throw new Error(
      'capture cannot overwrite the registered contract, transition history, or pending change record.',
    );
  }
  const registered = await readRegisteredContract();
  const contract = await captureMcpContract(registered.contract.origin);
  const candidateSha256 = digestMcpContract(contract);
  await writeJsonFile(outputPath, {
    candidateSha256,
    contract,
  });
  console.log(
    `Captured MCP candidate ${candidateSha256} at ${outputPath}.`,
  );
}

async function bootstrapContract(): Promise<void> {
  if (await pathExists(REGISTERED_CONTRACT_PATH)) {
    throw new Error('The registered MCP contract already exists.');
  }
  if (await pathExists(PENDING_CHANGE_PATH)) {
    throw new Error(
      'Remove the pending MCP change record before bootstrapping.',
    );
  }
  const history = await pathExists(CONTRACT_HISTORY_PATH)
    ? await readContractHistory()
    : createEmptyMcpContractHistory();
  if (history.transitions.length > 0) {
    throw new Error(
      'The MCP contract history must be empty before bootstrapping.',
    );
  }
  const contract = await captureMcpContract();
  const registered = createRegisteredMcpContract(contract, 'developer');
  await writeJsonFile(CONTRACT_HISTORY_PATH, history);
  await writeJsonFile(REGISTERED_CONTRACT_PATH, registered);
  console.log(
    `Bootstrapped developer MCP contract ${registered.contractSha256}.`,
  );
}

async function promoteContract(): Promise<void> {
  const digest = argumentValue('--digest');
  const action = argumentValue('--action');
  if (!digest || !action) {
    throw new Error(
      'promote requires --digest <sha256> --action <developer-refresh|published-version>.',
    );
  }
  if (
    action !== 'developer-refresh'
    && action !== 'published-version'
  ) {
    throw new Error(`Unsupported MCP lifecycle action ${action}.`);
  }

  const registered = await readRegisteredContract();
  const history = await readContractHistory();
  const pending = await readPendingChange();
  if (!pending) {
    throw new Error('No pending MCP contract change record exists.');
  }
  if (isCompletedMcpContractPromotion(
    registered,
    history,
    pending,
    digest,
    action,
  )) {
    await verifyBaselineTransition(registered, history);
    const liveContract = await captureMcpContract(
      registered.contract.origin,
    );
    if (digestMcpContract(liveContract) !== registered.contractSha256) {
      throw new Error(
        'The live MCP contract changed after the interrupted promotion.',
      );
    }
    await unlink(PENDING_CHANGE_PATH);
    console.log(
      `Recovered completed MCP promotion ${registered.contractSha256}.`,
    );
    return;
  }
  const candidate = await captureMcpContract(registered.contract.origin);
  const evaluation = evaluateMcpContractGate(
    registered,
    candidate,
    pending,
  );
  if (evaluation.errors.length > 0) {
    throw new Error(evaluation.errors.join(' '));
  }
  if (!evaluation.pendingActionRequired) {
    throw new Error('The MCP contract has no metadata changes to promote.');
  }
  if (digest !== evaluation.candidateSha256) {
    throw new Error('The supplied digest does not match the MCP candidate.');
  }
  if (action !== pending.lifecycleAction) {
    throw new Error(
      'The supplied lifecycle action does not match the pending record.',
    );
  }

  const lifecycle = action === 'published-version'
    ? 'published'
    : registered.lifecycle;
  const promoted = createRegisteredMcpContract(candidate, lifecycle);
  const promotionHistory = prepareMcpContractPromotionHistory(
    registered,
    promoted,
    history,
    pending,
  );
  await verifyBaselineTransition(
    promoted,
    promotionHistory.nextHistory,
  );
  await writeJsonFile(
    CONTRACT_HISTORY_PATH,
    promotionHistory.nextHistory,
  );
  await writeJsonFile(REGISTERED_CONTRACT_PATH, promoted);
  await unlink(PENDING_CHANGE_PATH);
  console.log(
    `Promoted ${lifecycle} MCP contract ${promoted.contractSha256}.`,
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'check') {
    await checkContract();
  } else if (command === 'capture') {
    await captureContract();
  } else if (command === 'bootstrap') {
    await bootstrapContract();
  } else if (command === 'promote') {
    await promoteContract();
  } else {
    throw new Error(
      'Use one of: check, capture, bootstrap, or promote.',
    );
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'MCP contract command failed.',
  );
  process.exitCode = 1;
});
