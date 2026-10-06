import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

function moduleSurface(relativePath: string): { dependencies: string[]; identifiers: string[] } {
  const path = resolve(__dirname, relativePath);
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const dependencies: string[] = [];
  const identifiers: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      dependencies.push(node.moduleSpecifier.text);
    }
    if (ts.isIdentifier(node)) identifiers.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { dependencies, identifiers };
}

describe('service connection module boundary', () => {
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
