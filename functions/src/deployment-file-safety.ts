import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FORBIDDEN_FUNCTION_SOURCE_FILE_PATTERNS = [
  /(?:^|\/)\.env(?:\..*)?$/,
  /(?:^|\/)\.runtimeconfig\.json$/,
  /(?:^|\/)[^/]*service[-_]?account[^/]*\.json$/i,
  /(?:^|\/)[^/]*firebase-adminsdk[^/]*\.json$/i,
] as const;

const FUNCTION_SOURCE_SCAN_IGNORED_DIRECTORIES = new Set([
  '.git',
  'coverage',
  'emulator-export',
  'firestore_export',
  'lib',
  'node_modules',
  'tmp',
]);

function toPortableRelativePath(rootDirectory: string, filePath: string): string {
  return relative(rootDirectory, filePath).split(sep).join('/');
}

export function listFunctionSourceFiles(rootDirectory: string): string[] {
  const files: string[] = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!FUNCTION_SOURCE_SCAN_IGNORED_DIRECTORIES.has(entry.name)) {
          pendingDirectories.push(join(directory, entry.name));
        }
        continue;
      }
      if (entry.isFile()) {
        files.push(toPortableRelativePath(rootDirectory, join(directory, entry.name)));
      }
    }
  }

  return files.sort();
}

export function findForbiddenFunctionSourceFiles(fileNames: readonly string[]): string[] {
  return fileNames
    .filter(fileName => FORBIDDEN_FUNCTION_SOURCE_FILE_PATTERNS.some(pattern => pattern.test(fileName)))
    .sort();
}
