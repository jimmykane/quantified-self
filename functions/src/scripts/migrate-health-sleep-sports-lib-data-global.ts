import {
    hasBlockingSportsLibDataGlobalMigrationResult,
    runSportsLibDataGlobalMigration,
} from '../health/sports-lib-data-global-migration';

const LOG_PREFIX = '[sports-lib-health-sleep-global-migration]';

async function main(): Promise<void> {
    const summary = await runSportsLibDataGlobalMigration(process.argv.slice(2));
    process.stdout.write(`${LOG_PREFIX} Summary ${JSON.stringify(summary)}\n`);
    if (hasBlockingSportsLibDataGlobalMigrationResult(summary)) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(() => {
        process.stderr.write(`${LOG_PREFIX} Failed before an opaque resumable summary was produced.\n`);
        process.exitCode = 1;
    });
}
