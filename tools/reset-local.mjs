import process from 'node:process';
import { readEmulatorHub, readLocalRuntimeConfiguration, removeLocalState } from './local-runtime.mjs';

async function main() {
  const { runtimeConfig } = await readLocalRuntimeConfiguration();
  try {
    await readEmulatorHub(runtimeConfig);
    throw new Error('[local-reset] Stop npm start before resetting emulator data.');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[local-reset]')) {
      throw error;
    }
  }
  await removeLocalState();
  console.info('[local-reset] Removed .local/firebase-emulator-data. This cannot be recovered unless you made a separate copy.');
  console.info('[local-reset] Clear browser site data for 127.0.0.1 if you also want to remove cached Auth and Firestore state.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
