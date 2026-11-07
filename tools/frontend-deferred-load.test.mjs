import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parseTemplate, TmplAstElement, TmplAstRecursiveVisitor, tmplAstVisitAll } from '@angular/compiler';

function checkTemplate(source, path) {
  const parsed = parseTemplate(source, path);
  assert.equal(parsed.errors, null, `${path}: invalid Angular template`);
  let count = 0;
  class RecoveryVisitor extends TmplAstRecursiveVisitor {
    visitDeferredBlock(block) {
      count++;
      assert.ok(block.error?.children.some(child => child instanceof TmplAstElement && child.name === 'app-deferred-load-error'),
        `${path}:${block.sourceSpan.start.line + 1}: @defer needs an eager shared @error recovery component`);
      super.visitDeferredBlock(block);
    }
  }
  tmplAstVisitAll(new RecoveryVisitor(), parsed.nodes);
  return count;
}

test('every app @defer has eager shared error recovery, including nested and future templates', () => {
  const root = new URL('../src/', import.meta.url);
  let count = 0;
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const path = join(entry.parentPath, entry.name), source = readFileSync(path, 'utf8');
    if (source.includes('@defer')) count += checkTemplate(source, path);
  }
  assert.ok(count > 0, 'The recovery guard must discover actual deferred views');
});

test('missing, empty or deferred-only recovery cannot silently pass the template guard', () => {
  for (const source of [
    '@defer { <div></div> }',
    '@if (true) { @defer { <div></div> } @error { <p>Failed</p> } }',
    '@defer { <div></div> } @error { @defer { <app-deferred-load-error area="navigation" /> } }',
  ]) assert.throws(() => checkTemplate(source, 'fixture.html'), /needs an eager shared/);
  assert.equal(checkTemplate('@if (true) { @defer { <div></div> } @error { <app-deferred-load-error area="navigation" /> } }', 'fixture.html'), 1);
});
