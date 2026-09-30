import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parse, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

describe('compact day-sheet styles', () => {
  const sass = createRequire(createRequire(import.meta.url).resolve('@angular/build/package.json'))('sass') as typeof import('sass');
  const compile = (file: string) => parse(sass.compile(resolve(process.cwd(), file), {
    loadPaths: [resolve(process.cwd(), 'node_modules')],
  }).css);
  const sheet = compile('src/app/components/calendar/calendar-day-details/calendar-day-details.component.scss');
  const rules: Rule[] = [];
  sheet.walkRules(rule => { rules.push(rule); });
  const declarations = (element: Element, property: string) => rules.flatMap(rule => {
    if (!element.matches(rule.selector)) return [];
    const values: string[] = [];
    rule.walkDecls(property, declaration => { values.push(declaration.value); });
    return values;
  });
  const document = new DOMParser().parseFromString(`<section>
    <div class="calendar-day-details-content">
      <div class="calendar-day-total"><span><span class="calendar-day-number">2</span> completed activities</span></div>
      <a class="calendar-day-entry-item"><span class="calendar-day-entry-title">Long workout title</span></a>
      <div class="calendar-day-planned-row"><button><span class="calendar-day-duplicate-icon"></span></button></div>
      <p class="calendar-day-empty" role="status">Loading activities…</p>
    </div>
  </section>`, 'text/html');

  it('keeps sheet titles readable without recoloring other day-view links', () => {
    const title = document.querySelector('.calendar-day-entry-title')!;
    expect(declarations(title, 'color')).toEqual(['var(--mat-sys-on-surface)']);
    expect(declarations(title, 'font').at(-1)).toBe('var(--mat-sys-body-medium)');
    const context = compile('src/app/components/calendar/calendar-day-context/calendar-day-context.component.scss');
    const linkColors: string[] = [];
    context.walkRules(rule => {
      if (rule.selector === '.calendar-day-context-navigation-link') {
        rule.walkDecls('color', declaration => { linkColors.push(declaration.value); });
      }
    });
    expect(linkColors).toEqual(['var(--mat-sys-primary)']);
  });

  it('does not reset the numeric count font through supporting-text descendants', () => {
    const number = document.querySelector('.calendar-day-number')!;
    expect(declarations(number, 'font')).toEqual([]);
    expect(declarations(number, 'font-family')).toEqual(['"Barlow Condensed", sans-serif']);
    expect(declarations(number.parentElement!, 'font')).toEqual(['var(--mat-sys-body-small)']);
    expect(declarations(document.querySelector('.calendar-day-empty')!, 'font')).toEqual(['var(--mat-sys-body-small)']);
  });

  it('keeps Material rows content-sized with a usable minimum action height', () => {
    const item = document.querySelector('.calendar-day-entry-item')!;
    expect(declarations(item, 'height')).toEqual(['auto']);
    expect(declarations(item, 'min-height')).toEqual(['44px']);
    const content = rules.find(rule => rule.selector === '.calendar-day-details-content')!;
    const heightTokens: string[] = [];
    content.walkDecls(declaration => {
      if (declaration.prop.endsWith('one-line-container-height')) heightTokens.push(declaration.value);
    });
    expect(heightTokens).toEqual(['auto']);
  });

  it('centers both duplicate states in one box and sizes the Material button through public tokens', () => {
    const button = document.querySelector('.calendar-day-planned-row > button')!;
    expect(declarations(button, '--mat-icon-button-state-layer-size')).toEqual(['48px']);
    const iconBox = button.querySelector('.calendar-day-duplicate-icon')!;
    for (const [property, expected] of [['display', 'flex'], ['align-items', 'center'],
      ['justify-content', 'center'], ['width', '24px'], ['height', '24px']]) {
      expect(declarations(iconBox, property)).toEqual([expected]);
    }
  });

  it('keeps planned rows aligned without decorative rails or compensating indentation', () => {
    expect(rules.some(rule => rule.selector.includes('calendar-day-planned-accent'))).toBe(false);
    const row = document.querySelector('.calendar-day-planned-row')!;
    for (const property of ['margin-inline-start', 'padding-inline-start', 'border-left', 'border-inline-start']) {
      expect(declarations(row, property)).toEqual([]);
    }
  });

  it('shares sheet typography and icon layout with previews without smaller month/mobile overrides', () => {
    const context = compile('src/app/components/calendar/calendar-day-context/calendar-day-context.component.scss');
    const contextValues = (selector: string, property: string) => {
      const values: string[] = [];
      context.walkRules(rule => {
        if (rule.selector === selector) rule.walkDecls(property, declaration => { values.push(declaration.value); });
      });
      return values;
    };
    for (const [property, expected] of [['font', 'var(--mat-sys-body-medium)'], ['color', 'var(--mat-sys-on-surface)']]) {
      expect(contextValues('.calendar-day-context-preview-title', property).at(-1)).toBe(expected);
    }
    expect(contextValues('.calendar-day-context-preview-copy small', 'font')).toEqual(['var(--mat-sys-body-small)']);
    expect(contextValues('.calendar-day-context-preview-entry', 'grid-template-columns')).toEqual(['24px minmax(0, 1fr) auto']);
    expect(contextValues('.calendar-day-context-preview-entry', 'min-height')).toEqual(['44px']);
    expect(contextValues('.calendar-day-context-preview-icon', 'height')).toEqual(['20px']);
    expect(contextValues('.calendar-day-context-preview-note-entry', 'grid-template-columns')).toEqual(['24px minmax(0, 1fr) auto']);
    expect(contextValues('.calendar-day-context-preview-note-button', 'min-height')).toEqual(['44px']);
    expect(contextValues('.calendar-day-context-preview-note-button', '--mat-button-text-with-icon-horizontal-padding')).toEqual(['0']);
    expect(contextValues('.calendar-day-context-preview-note-button', '--mat-button-text-container-height')).toEqual(['auto']);
    expect(contextValues('.calendar-day-context-preview-plan > button', '--mat-icon-button-state-layer-size')).toEqual(['48px']);
    context.walkRules(rule => {
      if (rule.selector.includes('calendar-day-context--calm-month') && /preview-(title|entry|icon|copy)/.test(rule.selector)) {
        const overridden: string[] = [];
        rule.walkDecls(declaration => { overridden.push(declaration.prop); });
        expect(overridden).not.toContain('font');
        expect(overridden).not.toContain('font-size');
      }
    });
  });
});
