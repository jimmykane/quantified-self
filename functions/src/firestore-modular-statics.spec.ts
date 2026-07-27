import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const LEGACY_FIRESTORE_STATICS = new Set([
  'FieldPath',
  'FieldValue',
  'Timestamp',
]);

function listRuntimeTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'scripts'
        ? []
        : listRuntimeTypeScriptFiles(path);
    }
    if (
      !entry.isFile()
      || !entry.name.endsWith('.ts')
      || entry.name.endsWith('.d.ts')
      || entry.name.endsWith('.spec.ts')
      || entry.name.endsWith('.test.ts')
    ) {
      return [];
    }
    return [path];
  });
}

function isLegacyFirestoreStaticAccess(node: ts.Node): node is ts.PropertyAccessExpression {
  if (!ts.isPropertyAccessExpression(node) || !LEGACY_FIRESTORE_STATICS.has(node.name.text)) {
    return false;
  }
  const firestoreAccess = node.expression;
  return ts.isPropertyAccessExpression(firestoreAccess)
    && firestoreAccess.name.text === 'firestore'
    && ts.isIdentifier(firestoreAccess.expression)
    && firestoreAccess.expression.text === 'admin';
}

describe('Functions Firestore imports', () => {
  it('does not use legacy admin.firestore static exports in runtime code', () => {
    const sourceRoot = __dirname;
    const violations: string[] = [];

    for (const file of listRuntimeTypeScriptFiles(sourceRoot)) {
      const sourceFile = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node): void => {
        if (isLegacyFirestoreStaticAccess(node)) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push(`${relative(sourceRoot, file)}:${line + 1}:${character + 1} ${node.getText(sourceFile)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
