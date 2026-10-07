import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

function moduleSurface(relativePath: string): { dependencies: string[]; identifiers: string[]; exports: string[] } {
  const path = resolve(__dirname, relativePath);
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const dependencies: string[] = [];
  const identifiers: string[] = [];
  const exports: string[] = [];
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        exports.push(...node.exportClause.elements.map(element => element.name.text));
      } else {
        exports.push(node.exportClause ? node.exportClause.name.text : '*');
      }
    } else if (ts.isExportAssignment(node)) {
      exports.push(node.isExportEquals ? 'export=' : 'default');
    } else if (ts.canHaveModifiers(node)
      && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(node)) {
        exports.push(...node.declarationList.declarations.map(declaration => declaration.name.getText(source)));
      } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
        || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
        || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name) {
        exports.push(node.name.text);
      }
    }
  }
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      dependencies.push(node.moduleSpecifier.text);
    }
    if (ts.isIdentifier(node)) identifiers.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { dependencies, identifiers, exports };
}

describe('service connection module boundary', () => {
  it('preserves the existing facade exports without exposing lifecycle composition helpers', () => {
    expect(moduleSurface('service-connection-meta.ts').exports.sort()).toEqual([
      'MarkServiceReconnectRequiredOptions',
      'ServiceConnectionProviderUserIdPinOptions',
      'ServiceConnectionProviderUserIdPinResult',
      'ServiceDisconnectPendingMetaInput',
      'WAHOO_OPAQUE_REFRESH_FAILURE_THRESHOLD',
      'WahooOpaqueRefreshFailureClaim',
      'WahooOpaqueRefreshFailureOutcome',
      'beginPendingDisconnectQueueReleaseRepair',
      'clearServiceConnectionState',
      'completePendingDisconnectQueueReleaseRepair',
      'getServiceConnectionMeta',
      'isServiceReconnectRequiredForUser',
      'isServiceUnavailableForSyncForUser',
      'markServiceConnected',
      'markServiceReconnectRequired',
      'mirrorServiceDisconnectPendingToUserMeta',
      'pinServiceConnectionProviderUserIdIfUnset',
      'recordWahooOpaqueRefreshFailure',
      'retryPendingCOROSHealthLifecycleProjection',
      'retryPendingDisconnectQueueRelease',
      'retryPendingHealthLifecycleProjection',
      'retryPendingServiceRouteRestore',
      'retryWahooReconnectQueueRelease',
      'setServiceConnectionProviderUserId',
      'supersedePendingCOROSHealthLifecycleProjectionForTokenRootDelete',
      'supersedePendingHealthLifecycleProjectionForTokenRootDelete',
    ]);
  });

  it('keeps Wahoo recovery and compatibility-facade dependencies out of the generic lifecycle', () => {
    const { dependencies, identifiers } = moduleSurface('service-connection-lifecycle.ts');
    expect(dependencies.some(path => path.includes('/wahoo/') || path.endsWith('/service-connection-meta')))
      .toBe(false);
    expect(identifiers.filter(name => /wahoo/i.test(name))).toEqual([]);
    expect(identifiers).not.toContain('releaseQueueItemsDeferredForReconnectRequired');
  });

  it('lets Wahoo recovery use the generic lifecycle without importing its facade', () => {
    const { dependencies } = moduleSurface('wahoo/connection-recovery.ts');
    expect(dependencies).toContain('../service-connection-lifecycle');
    expect(dependencies).not.toContain('../service-connection-meta');
  });
});
