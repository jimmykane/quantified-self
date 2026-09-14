import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configSchema, mutationActions, report, type Action, type Config } from './garmin-training-certification/model';
import { withJournal } from './garmin-training-certification/journal';
import { CertificationRunner, type RunnerDependencies } from './garmin-training-certification/runner';
import { certificationAuthority } from './garmin-training-certification/authority';
import { createGarminTrainingClient } from '../training-plans/delivery/garmin/http';
import { TrainingDeliveryTransportError } from '../training-plans/delivery/contracts';

type Command = 'prepare' | 'preflight' | 'report' | Action;
interface Options { command: Command; directory: string; config: Config | null; approved?: string; }
export function parseCertificationOptions(argv: readonly string[]): Options {
  const [command, ...args] = argv;
  if (!['prepare', 'preflight', 'report', 'inspect', ...mutationActions].includes(command)) throw new Error('Invalid command.');
  const values: Record<string, string> = {};
  const allowed = command === 'prepare' ? ['directory', 'project', 'uid', 'date', 'time-zone', 'sport']
    : command === 'report' ? ['directory'] : ['directory', 'approve'];
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !allowed.includes(match[1]) || Object.prototype.hasOwnProperty.call(values, match[1])) throw new Error('Invalid option.');
    values[match[1]] = match[2];
  }
  if (!values.directory || !isAbsolute(values.directory) || /[\r\n\0]/.test(values.directory)) throw new Error('An absolute private directory is required.');
  if (values.approve !== undefined && !/^[a-f0-9]{64}$/.test(values.approve)) throw new Error('Invalid approval.');
  return { command: command as Command, directory: values.directory, approved: values.approve,
    config: command === 'prepare' ? configSchema.parse({ project: values.project, uid: values.uid, date: values.date,
      timeZone: values['time-zone'], sport: values.sport }) : null };
}

interface Runtime extends RunnerDependencies { close(): Promise<void>; }
type RuntimeFactory = (config: Config) => Promise<Runtime>;
async function liveRuntime(config: Config): Promise<Runtime> {
  // Never combine fake/emulator authority with a live transport. Tests inject a runtime
  // in code; no browser parameter, environment flag, CLI switch or config selects a fake.
  if (Object.keys(process.env).some(key => key.endsWith('_EMULATOR_HOST') && process.env[key])
    || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Live environment required.');
  const { initializeApp, applicationDefault, deleteApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const app = initializeApp({ projectId: config.project, credential: applicationDefault() }, `garmin-cert-${randomUUID()}`);
  const db = getFirestore(app);
  const authority = certificationAuthority(db, getAuth(app), config);
  return { authority, client: createGarminTrainingClient(async () => (await authority()).accessToken),
    now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    close: async () => { try { await db.terminate(); } finally { await deleteApp(app); } } };
}

/** Offline prepare/report/action previews do not even initialize Firebase. */
export async function runCertificationCLI(argv: readonly string[], write: (value: unknown) => void,
  runtimeFactory: RuntimeFactory = liveRuntime): Promise<void> {
  const options = parseCertificationOptions(argv);
  await withJournal(options.directory, options.config, async journal => {
    if (options.command === 'prepare' || options.command === 'report') { write(report(journal.state)); return; }
    if (options.command !== 'preflight' && options.approved === undefined) {
      // Preview needs only local state; impossible to invoke either authority or HTTP.
      const unavailable = async (): Promise<never> => { throw new Error('Preview has no network runtime.'); };
      write(new CertificationRunner(journal, { authority: unavailable, client: unavailable, now: Date.now, sleep: unavailable }).preview(options.command)); return;
    }
    const runtime = await runtimeFactory(journal.state.config);
    try {
      const runner = new CertificationRunner(journal, runtime);
      write(options.command === 'preflight' ? await runner.preflight(options.approved) : await runner.execute(options.command, options.approved!));
    } finally { await runtime.close(); }
  });
}

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write('Garmin evaluation runner (#698). See docs/training-workspace.md, Garmin certification runner.\n'
      + 'prepare --directory=<empty-private-absolute-directory> --project=<project> --uid=<approved-test-uid> --date=YYYY-MM-DD --time-zone=<IANA> --sport=running|cycling\n'
      + 'preflight|create|update|reschedule|inspect|remove --directory=<directory> [--approve=<preview-digest>]\n'
      + 'report --directory=<directory>\n'
      + 'preflight reads Firebase only. Other actions are offline previews until approved. Each approval permits real Garmin requests; remove needs separate approval. No deployment or global enablement.\n');
  } else {
    runCertificationCLI(process.argv.slice(2), value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => {
      process.stderr.write(`${JSON.stringify({ error: error instanceof TrainingDeliveryTransportError ? error.kind : 'local_failure',
        guidance: 'Preserve the private journal. Inspect the documented recovery procedure; never delete a journal to retry an uncertain create.' })}\n`);
      process.exitCode = 1;
    });
  }
}
