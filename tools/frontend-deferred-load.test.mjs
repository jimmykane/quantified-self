import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parseTemplate, TmplAstElement, TmplAstRecursiveVisitor, tmplAstVisitAll } from '@angular/compiler';
import ts from 'typescript';

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

function checkSourceFile(source, path) {
  if (path.endsWith('.html')) return source.includes('@defer') ? checkTemplate(source, path) : 0;
  if (!path.endsWith('.ts') || path.endsWith('.spec.ts') || path.endsWith('.d.ts')) return 0;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const visit = node => {
    // Inspect literals themselves so a separate template constant (including an imported one) cannot hide a block.
    const template = ts.isStringLiteralLike(node) ? node.text
      : ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => span.literal.text).join('') : '';
    assert.ok(!/@defer(?:\s*\([^{}]*\))?\s*\{/.test(template),
      `${path}: put @defer in an external HTML template so recovery coverage is checked`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return 0;
}

test('every app @defer has eager shared error recovery, including nested and future templates', () => {
  const root = new URL('../src/', import.meta.url);
  let count = 0;
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(html|ts)$/.test(entry.name) || /\.(spec|d)\.ts$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name), source = readFileSync(path, 'utf8');
    count += checkSourceFile(source, path);
  }
  assert.ok(count > 0, 'The recovery guard must discover actual deferred views');
});

test('inline runtime templates cannot bypass the external-template recovery guard', () => {
  for (const template of ["'@defer { <div></div> }'", '`@defer { <div></div> } @error { <app-deferred-load-error area="navigation" /> }`',
    '`@defer { <div>${value}</div> }`', "('@defer { <div></div> }')"]) {
    assert.throws(() => checkSourceFile(`@Component({ template: ${template} }) class FutureComponent {}`, 'future.component.ts'), /external HTML template/);
  }
  assert.equal(checkSourceFile("// @defer comment\n@Component({ template: '<p>Plain template</p>' }) class Example {}", 'example.ts'), 0);
  assert.equal(checkSourceFile("const documentation = { text: '@defer' };", 'example.ts'), 0);
  assert.equal(checkSourceFile("@Component({template: '@defer { <div></div> }'}) class TestFixture {}", 'example.spec.ts'), 0);
  assert.throws(() => checkSourceFile("export const TEMPLATE = '@defer { <div></div> }';", 'preview-markup.ts'), /external HTML template/);
  assert.throws(() => checkSourceFile("const template = '@\\u0064efer (when ready()) { <div></div> }';", 'preview-markup.ts'), /external HTML template/);
});

test('missing, empty or deferred-only recovery cannot silently pass the template guard', () => {
  for (const source of [
    '@defer { <div></div> }',
    '@if (true) { @defer { <div></div> } @error { <p>Failed</p> } }',
    '@defer { <div></div> } @error { @defer { <app-deferred-load-error area="navigation" /> } }',
  ]) assert.throws(() => checkTemplate(source, 'fixture.html'), /needs an eager shared/);
  assert.equal(checkTemplate('@if (true) { @defer { <div></div> } @error { <app-deferred-load-error area="navigation" /> } }', 'fixture.html'), 1);
});
