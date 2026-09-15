import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parse, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

describe('shared QS scrollbar skin', () => {
  const sass = createRequire(createRequire(import.meta.url).resolve('@angular/build/package.json'))('sass') as typeof import('sass');
  const css = sass.compileString('@use "scrollbars"; @include scrollbars.global(#e6e1e5);', {
    loadPaths: [resolve(process.cwd(), 'src/styles')],
  }).css;
  const sheet = parse(css);
  const rules: Rule[] = [];
  sheet.walkRules(rule => { rules.push(rule); });
  const skin = rules.find(rule => rule.selectors.includes(':where(*)'))!;
  const declaration = (rule: Rule, property: string) => {
    let value: string | undefined;
    rule.walkDecls(property, decl => { value = decl.value; });
    return value;
  };

  it('is included once globally, without per-Material-panel copies', () => {
    const global = readFileSync(resolve(process.cwd(), 'src/styles.scss'), 'utf8');
    expect(global.match(/@include scrollbars\.global\(/g)).toHaveLength(1);
    expect(global).toContain('scrollbars.global(mat.get-theme-color($app-dark-theme, on-surface))');
    expect(global).not.toMatch(/qs-scrollbar-skin|@extend \.qs-scrollbar/);
    expect(declaration(skin, 'scrollbar-width')).toBe('thin');
    expect(skin.selectors).toEqual([':where(*)', '.qs-scrollbar']);
  });

  it('matches all scroll owners, including overlays outside app-root and unmarked nested content', () => {
    const page = new DOMParser().parseFromString(`<html><body>
      <app-root><main><div class="custom-panel"><table></table><textarea></textarea></div></main></app-root>
      <div class="cdk-overlay-container"><div class="cdk-overlay-pane">
        <mat-dialog-container class="mat-mdc-dialog-container"><div class="mat-mdc-dialog-surface">
          <mat-dialog-content class="mat-mdc-dialog-content"><ol class="revision-list"></ol></mat-dialog-content>
        </div></mat-dialog-container>
        <mat-bottom-sheet-container class="mat-bottom-sheet-container"><section><div class="bottom-sheet-content"></div></section></mat-bottom-sheet-container>
        <div class="mat-mdc-menu-panel"><div class="mat-mdc-menu-content"></div></div>
        <div class="mat-mdc-select-panel"></div><div class="mat-mdc-autocomplete-panel"></div>
        <div class="mat-datepicker-content"></div><div class="new-unclassified-surface"></div>
      </div></div>
    </body></html>`, 'text/html');
    const elements = [...page.querySelectorAll('*')];
    expect(elements.length).toBeGreaterThan(20);
    for (const element of elements) {
      expect(element.matches(skin.selector), element.outerHTML).toBe(true);
      expect(element.classList.contains('qs-scrollbar')).toBe(false);
    }
  });

  it('retains the existing rounded 10px WebKit fallback and theme-aware colors', () => {
    const scrollbar = rules.find(rule => rule.selector.includes('::-webkit-scrollbar,'))!;
    expect(declaration(scrollbar, 'width')).toBe('10px');
    expect(declaration(scrollbar, 'height')).toBe('10px');
    const thumb = rules.find(rule => rule.selectors.includes(':where(*)::-webkit-scrollbar-thumb'))!;
    expect(declaration(thumb, 'border-radius')).toBe('999px');
    expect(declaration(thumb, 'border')).toBe('2px solid transparent');
    expect(declaration(thumb, 'background-clip')).toBe('content-box');
    expect(declaration(thumb, 'background-color')).toContain('var(--mat-sys-on-surface)');
    expect(declaration(thumb, 'background-color')).toContain('--qs-scrollbar-thumb-opacity, 30%');
    expect(declaration(skin, 'scrollbar-color')).toContain('--qs-scrollbar-opacity, 36%');
    const dark = rules.find(rule => rule.selector.includes(':where(.dark-theme,'))!;
    for (const [name, value] of [['opacity', '44%'], ['thumb-opacity', '40%'], ['hover-opacity', '56%'], ['active-opacity', '66%']]) {
      expect(declaration(dark, `--qs-scrollbar-${name}`)).toBe(value);
    }
    const viewport = rules.find(rule => rule.selector === ':where(html:has(> body.dark-theme))')!;
    expect(declaration(viewport, '--qs-scrollbar-ink')).toBe('#e6e1e5');
  });

  it('leaves high-contrast colors to the platform and keeps existing navigation exceptions', () => {
    const forced = rules.filter(rule => rule.parent?.type === 'atrule' && rule.parent.toString().includes('(forced-colors: active)'));
    expect(forced.some(rule => declaration(rule, 'scrollbar-color') === 'auto')).toBe(true);
    expect(forced.some(rule => declaration(rule, 'background-color') === 'CanvasText')).toBe(true);
    for (const file of [
      'src/app/app-shell.component.scss',
      'src/app/components/training/training-workspace.component.scss',
      'src/app/components/shared/workspace-section-navigation/workspace-section-navigation.component.scss',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).toContain('scrollbar-width: none');
      expect(source).toContain('::-webkit-scrollbar');
    }
    expect(css).not.toContain('!important');
  });

  it('does not force overflow, hide content, or change scroll layout and input behavior', () => {
    const allowed = new Set(['scrollbar-width', 'scrollbar-color', 'width', 'height', 'background',
      'background-color', 'background-clip', 'border', 'border-radius']);
    sheet.walkDecls(decl => {
      expect(allowed.has(decl.prop) || decl.prop.startsWith('--qs-scrollbar-'), decl.toString()).toBe(true);
      if (decl.prop === 'width' || decl.prop === 'height') {
        expect((decl.parent as Rule).selector).toContain('::-webkit-scrollbar');
      }
    });
  });
});
