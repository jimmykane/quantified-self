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

function getFirebaseAdminNamespaceBindings(sourceFile: ts.SourceFile): Set<string> {
  const bindings = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === 'firebase-admin'
    ) {
      const importClause = node.importClause;
      if (importClause?.name) {
        bindings.add(importClause.name.text);
      }
      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        bindings.add(importClause.namedBindings.name.text);
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer;
      if (
        initializer
        && ts.isCallExpression(initializer)
        && ts.isIdentifier(initializer.expression)
        && initializer.expression.text === 'require'
        && initializer.arguments.length === 1
        && ts.isStringLiteral(initializer.arguments[0])
        && initializer.arguments[0].text === 'firebase-admin'
      ) {
        bindings.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return bindings;
}

function isLegacyFirestoreStaticAccess(
  node: ts.Node,
  firebaseAdminBindings: Set<string>,
): node is ts.PropertyAccessExpression {
  if (!ts.isPropertyAccessExpression(node) || !LEGACY_FIRESTORE_STATICS.has(node.name.text)) {
    return false;
  }
  const firestoreAccess = node.expression;
  return ts.isPropertyAccessExpression(firestoreAccess)
    && firestoreAccess.name.text === 'firestore'
    && ts.isIdentifier(firestoreAccess.expression)
    && firebaseAdminBindings.has(firestoreAccess.expression.text);
}

function findLegacyFirestoreStaticAccesses(
  fileName: string,
  source: string,
): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const firebaseAdminBindings = getFirebaseAdminNamespaceBindings(sourceFile);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isLegacyFirestoreStaticAccess(node, firebaseAdminBindings)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(`${fileName}:${line + 1}:${character + 1} ${node.getText(sourceFile)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

describe('Functions Firestore imports', () => {
  it('detects legacy static access through a renamed firebase-admin namespace import', () => {
    const violations = findLegacyFirestoreStaticAccesses(
      'fixture.ts',
      "import * as firebaseAdmin from 'firebase-admin';\nfirebaseAdmin.firestore.FieldValue.serverTimestamp();\n",
    );

    expect(violations).toEqual([
      'fixture.ts:2:1 firebaseAdmin.firestore.FieldValue',
    ]);
  });

  it('detects legacy static access through a default firebase-admin import', () => {
    const violations = findLegacyFirestoreStaticAccesses(
      'fixture.ts',
      'import firebaseAdmin from "firebase-admin";\nfirebaseAdmin.firestore.Timestamp.now();\n',
    );

    expect(violations).toEqual([
      'fixture.ts:2:1 firebaseAdmin.firestore.Timestamp',
    ]);
  });

  it('detects legacy static access through a firebase-admin require alias', () => {
    const violations = findLegacyFirestoreStaticAccesses(
      'fixture.ts',
      "const firebaseAdmin = require('firebase-admin');\nfirebaseAdmin.firestore.FieldPath.documentId();\n",
    );

    expect(violations).toEqual([
      'fixture.ts:2:1 firebaseAdmin.firestore.FieldPath',
    ]);
  });

  it('does not use legacy admin.firestore static exports in runtime code', () => {
    const sourceRoot = __dirname;
    const violations: string[] = [];

    for (const file of listRuntimeTypeScriptFiles(sourceRoot)) {
      violations.push(...findLegacyFirestoreStaticAccesses(
        relative(sourceRoot, file),
        readFileSync(file, 'utf8'),
      ));
    }

    expect(violations).toEqual([]);
  });
});
