import { TestBed } from '@angular/core/testing';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { buildCalendarWeekSummary } from '../../../helpers/calendar-week-summary.helper';
import { CalendarWeekSummaryComponent } from './calendar-week-summary.component';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { writeFileSync } from 'node:fs';

describe('Calendar week summary presentation', () => {
  it('renders mixed unknown prescriptions and labels partial counts as observed', async () => {
    await TestBed.configureTestingModule({ imports: [CalendarWeekSummaryComponent],
      providers: [{ provide: AppHapticsService, useValue: { selection: vi.fn() } }] }).compileComponents();
    const fixture = TestBed.createComponent(CalendarWeekSummaryComponent);
    fixture.componentRef.setInput('summary', buildCalendarWeekSummary({
      window: { startMs: 1, endExclusiveMs: 2 }, startLocalDate: '2026-10-05', endLocalDate: '2026-10-11',
      events: { status: 'ready', data: [], complete: false }, completions: { status: 'ready', data: [], complete: true },
      schedule: { status: 'ready', complete: false, data: { state: { activePlanId: null }, workouts: [{
        schemaVersion: 1, id: 'synthetic', planId: null, localDate: '2026-10-06', lifecycle: 'planned', title: 'Synthetic',
        revision: 1, createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running, nodes: [
          { kind: 'step', id: 'time', purpose: 'work', ending: { kind: 'time', seconds: 600.25 }, targets: [] },
          { kind: 'step', id: 'manual', purpose: 'recovery', ending: { kind: 'manual' }, targets: [] },
        ] },
      }] } },
    }));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Observed scheduled');
    expect(fixture.nativeElement.textContent).toContain('unknown duration');
    expect(fixture.nativeElement.textContent).toContain('steps without prescribed distance');
    // Optional synthetic rendered fixture for browser layout QA; never contains account data.
    if (process.env.CALENDAR_WEEK_QA_DIR) writeFileSync(`${process.env.CALENDAR_WEEK_QA_DIR}/summary.html`,
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css">${document.head.querySelectorAll('style').length
        ? Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('') : ''}</head><body><main class="qs-workspace-page">${fixture.nativeElement.outerHTML}</main></body></html>`);
  });
  it('keeps failure unknown, exposes three distinct sources and owns one accessible retry', async () => {
    const selection = vi.fn();
    await TestBed.configureTestingModule({ imports: [CalendarWeekSummaryComponent],
      providers: [{ provide: AppHapticsService, useValue: { selection } }] }).compileComponents();
    const fixture = TestBed.createComponent(CalendarWeekSummaryComponent);
    fixture.componentRef.setInput('summary', buildCalendarWeekSummary({
      window: { startMs: 1, endExclusiveMs: 2 }, startLocalDate: '2026-10-05', endLocalDate: '2026-10-11',
      events: { status: 'error', data: [], complete: false }, schedule: { status: 'error', data: null, complete: false },
      completions: { status: 'error', data: [], complete: false },
    }));
    fixture.componentRef.setInput('canRetry', true);
    const retry = vi.fn(); fixture.componentInstance.retryRequested.subscribe(retry);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('.week-sources > section')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.week-counts').textContent).toContain('Unknown');
    expect(fixture.nativeElement.textContent).toContain('Planned load is unavailable');
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.type).toBe('button'); button.click();
    expect(retry).toHaveBeenCalledTimes(1); expect(selection).toHaveBeenCalledTimes(1);
  });
});
