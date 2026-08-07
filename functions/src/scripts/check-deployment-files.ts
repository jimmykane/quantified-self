import { resolve } from 'node:path';
import {
  findForbiddenFunctionSourceFiles,
  listFunctionSourceFiles,
} from '../deployment-file-safety';

const functionsSourceDirectory = resolve(process.argv[2] || process.cwd());
const forbiddenFiles = findForbiddenFunctionSourceFiles(
  listFunctionSourceFiles(functionsSourceDirectory),
);

if (forbiddenFiles.length > 0) {
  console.error('Refusing to deploy Functions while forbidden local configuration files are present:');
  for (const fileName of forbiddenFiles) console.error(`- ${fileName}`);
  console.error('Move these files out of the Functions source and retry. Use .secret.local only for emulator secrets.');
  process.exitCode = 1;
} else {
  console.log('Function deployment source contains no forbidden local configuration files.');
}
