import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    const text = render(session()).nativeElement.textContent;
    expect(text).toContain('Training impact');
    expect(text).toContain('Fitness load (CTL)');
    expect(text).toContain('+2');
    expect(text).toContain('Fatigue load (ATL)');
    expect(text).toContain('+12');
    expect(text).toContain('Freshness (Form)');
    expect(text).toContain('−10');
    expect(text).toContain('Fitness load rose after normal decay');
    expect(text).toContain('not measured physiological adaptation');
  });

  it('keeps values and the day outcome visible with model details in a labelled info tooltip', () => {
    const fixture = render(session(), 'strip');
    const element = fixture.nativeElement as HTMLElement;
    const values = Array.from(element.querySelectorAll('.training-impact-metrics strong')).map(value => value.textContent);
    const button = element.querySelector('button')!;
    const tooltip = fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);
    expect(element.querySelector('.training-impact--strip')).toBeTruthy();
    expect(values).toEqual(['+2', '+12', '−10', '84']);
    expect(element.querySelector('.training-impact-outcomes')?.textContent).toContain('Fitness load rose after normal decay');
    expect(button.getAttribute('aria-label')).toBe('About Training impact');
    expect(tooltip.message).toContain('not measured physiological adaptation');
    expect(tooltip.position).toBe('below');
    expect(element.querySelector('.training-impact-disclaimer')).toBeNull();
    expect(element.textContent).not.toContain('About this estimate');
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('shows details on mobile tap with one feedback owner and no change to the strip content', () => {
    const fixture = render(session(), 'strip');
    const tooltip = fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);
    const show = vi.spyOn(tooltip, 'show').mockImplementation(() => {});
    const hide = vi.spyOn(tooltip, 'hide').mockImplementation(() => {});
    const element = fixture.nativeElement as HTMLElement;
    const content = element.textContent;
    vi.useFakeTimers();
    try {
      element.querySelector('button')!.click(); fixture.detectChanges();
      expect(show).toHaveBeenCalledWith(0);
      expect(haptics.selection).toHaveBeenCalledOnce();
      expect(element.textContent).toBe(content);
      vi.advanceTimersByTime(2200);
      expect(hide).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3800);
      expect(hide).toHaveBeenCalledWith(0);
      element.querySelector('button')!.click();
      fixture.destroy(); hide.mockClear();
      vi.advanceTimersByTime(6000);
      expect(hide).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
