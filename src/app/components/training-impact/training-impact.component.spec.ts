import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { Platform } from '@angular/cdk/platform';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DistanceUnits, WeightUnits } from '@sports-alliance/sports-lib';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTrainingLoadPoints, resolveTrainingLoadDayImpact } from '@shared/training-load';
import type { TrainingDayImpactView, TrainingSessionImpactView } from '../../helpers/training-impact.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppWindowService } from '../../services/app.window.service';
import { TrainingImpactComponent, type TrainingImpactVariant } from './training-impact.component';

describe('TrainingImpactComponent', () => {
  const haptics = { selection: vi.fn() };
  beforeEach(() => {
    haptics.selection.mockClear();
    TestBed.configureTestingModule({
      imports: [TrainingImpactComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
        { provide: AppHapticsService, useValue: haptics },
        { provide: AppWindowService, useValue: { windowRef: { matchMedia: () => ({ matches: true }) } } },
      ],
    });
  });

  function render(
    impact: TrainingSessionImpactView | TrainingDayImpactView,
    variant: TrainingImpactVariant = 'card',
  ): ComponentFixture<TrainingImpactComponent> {
    const fixture = TestBed.createComponent(TrainingImpactComponent);
    fixture.componentRef.setInput('impact', impact);
    fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
    return fixture;
  }

  function session(): TrainingSessionImpactView {
    const point = buildTrainingLoadPoints([{ dayMs: Date.UTC(2026, 0, 1), load: 84 }])[0];
    const day = resolveTrainingLoadDayImpact([point], point.dayMs)!;
    return {
      availability: 'ready', message: '', headline: 'Helped push the day above maintenance',
      eventId: 'event', dayMs: point.dayMs,
      impact: {
        trainingStressScore: 84, ctlContribution: 2, atlContribution: 12,
        formContribution: -10, role: 'pushed-above-maintenance', day,
      },
    };
  }

  it('renders exact contribution labels, values, outcome, and disclaimer', () => {
    const fixture = render(session());
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Training impact');
    expect(fixture.nativeElement.querySelector('.training-impact-icon')).not.toBeNull();
    expect(text).toContain('Fitness load (CTL)');
    expect(text).toContain('+2');
    expect(text).toContain('Fatigue load (ATL)');
    expect(text).toContain('+12');
    expect(text).toContain('Freshness (Form)');
    expect(text).toContain('−10');
    expect(text).toContain('Fitness load rose after normal decay');
    expect(text).toContain('not measured physiological adaptation');
  });

  it('shows only three short metrics and moves the full breakdown into the event disclosure', () => {
    const fixture = render(session(), 'strip');
    const element = fixture.nativeElement as HTMLElement;
    const values = Array.from(element.querySelectorAll('.training-impact-session-metrics strong')).map(value => value.textContent);
    const button = element.querySelector('button')!;
    expect(element.querySelector('.training-impact--strip')).toBeTruthy();
    expect(element.querySelector('header .training-impact-icon')).toBeNull();
    expect(element.querySelector('header mat-divider.training-impact-heading-divider')?.getAttribute('aria-hidden')).toBe('true');
    expect(element.querySelectorAll('header mat-icon')).toHaveLength(1);
    expect(values).toEqual(['84', '+2', '+2']);
    expect(Array.from(element.querySelectorAll('.training-impact-session-metrics span')).map(label => label.textContent))
      .toEqual(['TSS', 'Workout CTL', 'Day CTL']);
    expect(element.querySelector('header')?.textContent).not.toContain('This workout’s contribution');
    expect(element.querySelector('.training-impact-metrics')?.getAttribute('aria-label')).toBe('This workout’s contribution');
    expect(element.querySelector('.training-impact-result')).toBeNull();
    expect(element.querySelector('.training-impact-outcomes')).toBeNull();
    expect(element.textContent).not.toContain('Helped push the day above maintenance');
    expect(element.textContent).not.toContain('Training-day outcome');
    expect(element.textContent).not.toContain('UTC');
    expect(button.textContent?.trim()).toBe('info_outline');
    expect(button.getAttribute('aria-label')).toBe('How Training impact is calculated');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const details = element.querySelector('.training-impact-calculation') as HTMLElement;
    expect(button.getAttribute('aria-controls')).toBe(details.id);
    expect(details.getAttribute('role')).toBe('region');
    expect(details.getAttribute('aria-labelledby')).toBe(button.id);
    expect(details.hidden).toBe(true);
    expect(details.querySelectorAll('.training-impact-metrics strong')).toHaveLength(4);
    expect(details.textContent).toContain('Fitness load increased by 2 CTL');
    expect(details.textContent).toContain('Fatigue load (ATL)');
    expect(details.textContent).toContain('Freshness (Form)');
    expect(details.textContent).toContain('all training counted for that day');
    expect(details.textContent).toContain('this workout’s 84 modeled TSS');
    expect(details.textContent).toContain('fixed daily cutoff');
    expect(details.textContent).toContain('not measured physiological adaptation');
    const tooltip = fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);
    expect(tooltip.message).toBe('How Training impact is calculated');
    expect(tooltip.position).toBe('above');
    expect(tooltip.touchGestures).toBe('off');
    expect(element.querySelector('.training-impact-disclaimer')).toBeNull();
    expect(element.textContent).not.toContain('About this estimate');
    expect(haptics.selection).not.toHaveBeenCalled();
    exportTrainingImpactQa(fixture, 'collapsed');
  });

  it('opens and closes calculation details with one feedback per click and silent initialization', () => {
    const fixture = render(session(), 'strip');
    const element = fixture.nativeElement as HTMLElement;
    const button = element.querySelector('button')!;
    const details = element.querySelector('.training-impact-calculation') as HTMLElement;
    const contributions = element.querySelector('.training-impact-session-metrics')?.textContent;
    expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(details.hidden).toBe(false);
    exportTrainingImpactQa(fixture, 'expanded');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(element.querySelector('.training-impact-session-metrics')?.textContent).toBe(contributions);
    button.click(); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(details.hidden).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('leaves touch scrolling available on the info icon without opening details or giving feedback', () => {
    TestBed.overrideProvider(Platform, { useValue: { isBrowser: true, ANDROID: true, IOS: false } });
    const fixture = render(session(), 'strip');
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const tooltip = fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);
    const show = vi.spyOn(tooltip, 'show');
    const touchStart = new TouchEvent('touchstart', { bubbles: true, cancelable: true });
    const touchMove = new TouchEvent('touchmove', { bubbles: true, cancelable: true });
    button.dispatchEvent(touchStart);
    button.dispatchEvent(touchMove);
    button.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true }));

    expect(tooltip.touchGestures).toBe('off');
    expect(button.style.touchAction).not.toBe('none');
    expect(touchStart.defaultPrevented).toBe(false);
    expect(touchMove.defaultPrevented).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(fixture.componentInstance.calculationExpanded()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();

    button.click(); fixture.detectChanges();
    expect(fixture.componentInstance.calculationExpanded()).toBe(true);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
  });

  it.each([
    [1.98, '+1.98'], [-1.98, '−1.98'], [0, '0'], [-0, '0'],
    [Number.EPSILON, '0'], [-Number.EPSILON, '0'], [0.0049, '0'], [-0.0049, '0'],
  ])('renders the net day change %s without confusing it with the workout contribution', (change, expected) => {
    const view = session();
    view.impact!.day = { ...view.impact!.day, ctlChange: change as number };
    const element = render(view, 'strip').nativeElement as HTMLElement;
    expect(element.querySelector('.training-impact-session-metrics > div:last-child strong')?.textContent).toBe(expected);
    expect(element.querySelector('.training-impact-session-metrics > div:nth-child(2) strong')?.textContent).toBe('+2');
    expect(element.querySelector('.training-impact-session-metrics > div:last-child')?.getAttribute('aria-label'))
      .toContain('Whole-day net fitness load change');
  });

  it('uses the display locale for both contribution values and the day result', () => {
    TestBed.overrideProvider(LOCALE_ID, { useValue: 'de-DE' });
    const view = session();
    view.impact!.ctlContribution = 4.69;
    view.impact!.day = { ...view.impact!.day, ctlChange: 1.98 };
    const element = render(view, 'strip').nativeElement as HTMLElement;
    expect(element.querySelector('.training-impact-metrics')?.textContent).toContain('+4,69');
    expect(element.querySelector('.training-impact-session-metrics')?.textContent).toContain('+4,69');
    expect(element.querySelector('.training-impact-session-metrics')?.textContent).toContain('+1,98');
    expect(element.querySelector('.training-impact-result-line')?.textContent).toContain('increased by 1,98 CTL');
  });

  it('shows a valid zero-TSS workout contribution even when the day lost fitness load', () => {
    const view = session();
    view.headline = 'No modeled load contribution';
    view.impact = {
      ...view.impact!, trainingStressScore: 0, ctlContribution: 0, atlContribution: 0, formContribution: 0,
      role: 'no-load', day: { ...view.impact!.day, ctlChange: -1.98, outcome: 'declined' },
    };
    const element = render(view, 'strip').nativeElement as HTMLElement;
    expect(Array.from(element.querySelectorAll('.training-impact-session-metrics strong')).map(value => value.textContent))
      .toEqual(['0', '0', '−1.98']);
    expect(element.querySelector('.training-impact-result-line')?.textContent).toContain('decreased by 1.98 CTL');
    expect(element.querySelector('.training-impact-calculation')?.textContent).toContain('this workout’s 0 modeled TSS');
  });

  it.each([null, { distanceUnits: DistanceUnits.Miles, weightUnits: WeightUnits.Pounds }])('uses canonical one-decimal modeled TSS without changing with unit preferences %#', settings => {
      const view = session();
      view.impact!.trainingStressScore = 76.34;
      const fixture = render(view, 'strip');
      fixture.componentRef.setInput('unitSettings', settings);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.training-impact-session-metrics strong').textContent).toBe('76.3');
    });

  it('retains the disclosure on same-event refresh but resets it on event, day, or availability changes', () => {
    const fixture = render(session(), 'strip');
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector('button')!.click(); fixture.detectChanges();
    fixture.componentRef.setInput('impact', session()); fixture.detectChanges();
    expect(element.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    fixture.componentRef.setInput('impact', { ...session(), eventId: 'next-event' }); fixture.detectChanges();
    expect(element.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    element.querySelector('button')!.click(); fixture.detectChanges();
    fixture.componentRef.setInput('impact', { ...session(), eventId: 'next-event', dayMs: Date.UTC(2026, 0, 2) });
    fixture.detectChanges();
    expect(element.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    element.querySelector('button')!.click(); fixture.detectChanges();
    fixture.componentRef.setInput('impact', { ...session(), availability: 'updating', message: 'Updating Training impact…' });
    fixture.detectChanges();
    expect(element.querySelector('button')).toBeNull();
    fixture.componentRef.setInput('impact', session()); fixture.detectChanges();
    expect(element.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('gives multiple event disclosures distinct accessible targets', () => {
    const first = render(session(), 'strip').nativeElement as HTMLElement;
    const second = render(session(), 'strip').nativeElement as HTMLElement;
    expect(first.querySelector('button')?.getAttribute('aria-controls'))
      .not.toBe(second.querySelector('button')?.getAttribute('aria-controls'));
  });

  it('retains honest updating, missing-TSS, and error states in the strip', () => {
    for (const availability of ['updating', 'missing-tss', 'error'] as const) {
      const fixture = render({
        availability, message: `${availability} explanation`, headline: null,
        eventId: 'event', dayMs: null, impact: null,
      }, 'strip');
      const element = fixture.nativeElement as HTMLElement;
      expect(element.textContent).toContain(`${availability} explanation`);
      expect(element.querySelector('.training-impact-state')?.getAttribute('role')).toBe(availability === 'error' ? 'alert' : 'status');
      expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe(String(availability === 'updating'));
      expect(element.querySelector('.training-impact-metrics')).toBeNull();
      expect(element.querySelector('button')).toBeNull();
    }
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('renders the compact headline and all three contributions', () => {
    const fixture = render(session(), 'compact');
    const element = fixture.nativeElement;
    const text = element.textContent;
    expect(text).toContain('Helped push the day above maintenance');
    expect(text).toContain('+2 CTL · +12 ATL · −10 Form');
    expect(element.querySelector('.training-impact-compact').getAttribute('role')).toBe('group');
    expect(element.querySelector('.training-impact-compact').getAttribute('aria-label'))
      .toContain('Fitness load (CTL) +2. Fatigue load (ATL) +12. Freshness (Form) −10');
  });

  it('renders updating and error states without guessed values', () => {
    const updating = render({
      availability: 'updating', message: 'Updating Training impact…', headline: null,
      eventId: 'event', dayMs: null, impact: null,
    }).nativeElement;
    expect(updating.textContent).toContain('Updating Training impact…');
    expect(updating.textContent).not.toContain('Fitness load (CTL)');

    const error = render({
      availability: 'error', message: 'Training impact could not be loaded.', headline: null,
      eventId: 'event', dayMs: null, impact: null,
    }).nativeElement;
    expect(error.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('renders separate UTC outcome lines for a multi-day total', () => {
    const first = session();
    const secondPoint = buildTrainingLoadPoints([
      { dayMs: Date.UTC(2026, 0, 1), load: 84 },
      { dayMs: Date.UTC(2026, 0, 2), load: 42 },
    ]);
    const secondDay = resolveTrainingLoadDayImpact(secondPoint, Date.UTC(2026, 0, 2))!;
    const view: TrainingDayImpactView = {
      availability: 'ready', message: '', headline: 'Activities span 2 UTC Training days',
      sessions: [first], trainingStressScore: 126, ctlContribution: 3,
      atlContribution: 18, formContribution: -15,
      outcomes: [first.impact!.day, secondDay], unavailableSessionCount: 0,
    };
    const element = render(view, 'summary').nativeElement;
    expect(element.textContent).toContain('Activities span 2 UTC Training days');
    expect(element.querySelector('.training-impact--summary')).toBeTruthy();
    expect(element.querySelectorAll('.training-impact-outcomes > div')).toHaveLength(2);
  });

  it('keeps detailed impact on its parent surface instead of adding nested cards', () => {
    const styles = readFileSync(resolve(process.cwd(),
      'src/app/components/training-impact/training-impact.component.scss'), 'utf8');
    const detailRule = styles.match(/\.training-impact\s*\{([^}]+)\}/)?.[1];
    const summaryRule = styles.match(/\.training-impact--summary\s*\{([^}]+)\}/)?.[1];

    expect(detailRule).toContain('border: 0;');
    expect(detailRule).toContain('margin: 0;');
    expect(detailRule).toContain('padding: 0;');
    expect(detailRule).toContain('background: transparent;');
    expect(styles).not.toContain('border-radius:');
    expect(styles).not.toContain('background: color-mix');
    expect(summaryRule).toContain('margin-top: 0;');
  });

  it('allows compact values to use an overlay-safe foreground without changing other previews', () => {
    const styles = readFileSync(resolve(process.cwd(),
      'src/app/components/training-impact/training-impact.component.scss'), 'utf8');
    const compactRule = styles.match(/\.training-impact-compact strong\s*\{([^}]+)\}/)?.[1];
    expect(compactRule).toContain('color: var(--training-impact-compact-value-color, var(--mat-sys-primary));');
  });

  it('renders separate UTC outcome lines for a compact multi-day total', () => {
    const first = session();
    const secondPoints = buildTrainingLoadPoints([
      { dayMs: Date.UTC(2026, 0, 1), load: 84 },
      { dayMs: Date.UTC(2026, 0, 2), load: 42 },
    ]);
    const secondDay = resolveTrainingLoadDayImpact(secondPoints, Date.UTC(2026, 0, 2))!;
    const view: TrainingDayImpactView = {
      availability: 'ready', message: '', headline: 'Activities span 2 UTC Training days',
      sessions: [first], trainingStressScore: 126, ctlContribution: 3,
      atlContribution: 18, formContribution: -15,
      outcomes: [first.impact!.day, secondDay], unavailableSessionCount: 0,
    };
    const element = render(view, 'compact').nativeElement;
    const outcomeLines = element.querySelectorAll('.training-impact-compact-outcomes > span');
    expect(outcomeLines).toHaveLength(2);
    expect(outcomeLines[0].textContent).toContain('Jan 1, 2026');
    expect(outcomeLines[0].textContent).toContain('Fitness load rose after normal decay');
    expect(outcomeLines[1].textContent).toContain('Jan 2, 2026');
  });
});

/** Optional snapshots of the actual rendered component for local phone/desktop theme QA. */
function exportTrainingImpactQa(fixture: ComponentFixture<TrainingImpactComponent>, name: string): void {
  const directory = process.env.TRAINING_IMPACT_QA_DIR;
  if (!directory) return;
  const styles = Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('');
  const sass = createRequire(createRequire(resolve('package.json')).resolve('@angular/build/package.json'))('sass');
  const componentStyles = sass.compileString('app-training-impact {' + readFileSync(resolve(process.cwd(),
    'src/app/components/training-impact/training-impact.component.scss'), 'utf8')
    .replace(/:host\(([^)]+)\)/g, '&$1').replace(/:host/g, '&') + '}').css;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Training impact preview</title>'
    + '<link rel="stylesheet" href="styles.css">' + styles + '<style>' + componentStyles + '</style></head><body class="app-hydrated">'
    + '<main class="qs-workspace-page"><app-training-impact class="training-impact-host--strip">'
    + fixture.nativeElement.innerHTML + '</app-training-impact></main></body></html>';
  writeFileSync(join(directory, `${name}.html`), html);
  writeFileSync(join(directory, `${name}-dark.html`), html.replace('class="app-hydrated"', 'class="app-hydrated dark-theme"'));
}
