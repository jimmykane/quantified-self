import {
    runSportsLibDataMigration,
} from '../health/sports-lib-data-migration';

const LOG_PREFIX = '[sports-lib-health-sleep-migration]';

async function main(): Promise<void> {
    const summary = await runSportsLibDataMigration(process.argv.slice(2));
    process.stdout.write(`${LOG_PREFIX} Summary ${JSON.stringify(summary)}\n`);
    if (!summary.dryRun && summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(() => {
        process.stderr.write(`${LOG_PREFIX} Failed before a resumable summary was produced.\n`);
        process.exitCode = 1;
    });
}
