import { main } from './frontend-test-shards.mjs';

main(process.argv.slice(2)).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
