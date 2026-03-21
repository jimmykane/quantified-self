import { existsSync } from 'node:fs';
import * as path from 'node:path';

export function resolveServiceAccountPath(options?: {
  runtimeDirname?: string;
}): string | null {
  const runtimeDirname = options?.runtimeDirname ?? __dirname;
  const candidatePaths = [
    path.resolve(runtimeDirname, '../service-account.json'),
    path.resolve(runtimeDirname, '../../../service-account.json'),
  ];

  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}
