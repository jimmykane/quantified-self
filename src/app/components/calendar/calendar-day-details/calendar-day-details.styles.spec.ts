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
    <div class="calendar-day-details"></div>
    <div class="calendar-day-details-content">
      <div class="calendar-day-total"><span><span class="calendar-day-number">2</span> completed activities</span></div>
      <a class="calendar-day-entry-item calendar-day-planned-item"><span class="calendar-day-entry-title">Long workout title</span></a>
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

  it('resets inherited overlay typography for all app-owned sheet content', () => {
    const container = document.querySelector('.calendar-day-details')!;
    expect(declarations(container, 'font')).toEqual(['var(--mat-sys-body-medium)']);
    expect(declarations(container, 'letter-spacing')).toEqual(['0']);
    expect(declarations(container, '--training-impact-compact-value-color')).toEqual(['var(--mat-sys-on-surface)']);
  });

  it('wraps compact impact text in the sheet and selected-day previews without changing shared defaults', () => {
    const container = document.querySelector('.calendar-day-details')!;
    expect(declarations(container, '--training-impact-compact-white-space')).toEqual(['normal']);
    const impact = compile('src/app/components/training-impact/training-impact.component.scss');
    const textRules: Rule[] = [];
    impact.walkRules(rule => {
      if (rule.selector.includes('.training-impact-compact > span')) textRules.push(rule);
    });
    expect(textRules).toHaveLength(1);
    expect(textRules[0].selector).toContain('.training-impact-compact > strong');
    expect(textRules[0].selector).toContain('.training-impact-compact-outcomes > span');
    const wrapping: string[] = [];
    textRules[0].walkDecls('white-space', declaration => { wrapping.push(declaration.value); });
    expect(wrapping).toEqual(['var(--training-impact-compact-white-space, nowrap)']);
    const context = compile('src/app/components/calendar/calendar-day-context/calendar-day-context.component.scss');
    const previewOverrides: { selector: string; value: string }[] = [];
    context.walkRules(rule => {
      rule.walkDecls('--training-impact-compact-white-space', declaration => {
        previewOverrides.push({ selector: rule.selector, value: declaration.value });
      });
    });
    expect(previewOverrides).toEqual([
      { selector: '.calendar-day-context-preview-copy app-training-impact', value: 'normal' },
    ]);
  });

  it('shares compact recovery typography without shrinking the full-day metrics', () => {
    const context = compile('src/app/components/calendar/calendar-day-context/calendar-day-context.component.scss');
    const compactRules: Rule[] = [];
    context.walkRules(rule => {
      if (/calendar-day-context--(compact|calm-month)/.test(rule.selector)
        && /calendar-day-context-metric (span|small|strong)/.test(rule.selector)) compactRules.push(rule);
    });
    expect(compactRules).toHaveLength(2);
    for (const rule of compactRules) {
      expect(rule.selector).toContain(':host(.calendar-day-context--compact)');
      expect(rule.selector).toContain(':host(.calendar-day-context--calm-month)');
    }
    const labels: string[] = [];
    const values: string[] = [];
    compactRules.forEach(rule => {
      rule.walkDecls('font', declaration => { labels.push(declaration.value); });
      rule.walkDecls('font-size', declaration => { values.push(declaration.value); });
    });
    expect(labels).toEqual(['var(--mat-sys-label-small)']);
    expect(values).toEqual(['19px']);
    const fullDayValues: string[] = [];
    context.walkRules(rule => {
      if (rule.selector === '.calendar-day-context-metric strong') {
        rule.walkDecls('font-size', declaration => { fullDayValues.push(declaration.value); });
      }
    });
    expect(fullDayValues).toEqual(['22px']);
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

  it('keeps planned rows aligned without decorative rails or compensating indentation', () => {
    expect(rules.some(rule => rule.selector.includes('calendar-day-planned-accent'))).toBe(false);
    expect(rules.some(rule => /calendar-day-(planned-row|duplicate-icon)/.test(rule.selector))).toBe(false);
    const row = document.querySelector('.calendar-day-planned-item')!;
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
