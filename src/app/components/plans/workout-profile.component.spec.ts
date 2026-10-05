import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { ActivityTypes, AppThemes } from '@sports-alliance/sports-lib';
import type { WorkoutStructureV1 } from '@shared/planned-workout';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';
import { WorkoutProfileComponent } from './workout-profile.component';

const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Running, nodes: [
  { kind: 'repeat', id: 'set', count: 2, steps: [{ kind: 'step', id: 'warmup', purpose: 'warmup', ending: { kind: 'time', seconds: 75 }, targets: [
    { kind: 'power', mode: 'absolute', minimumWatts: 200, maximumWatts: 200 },
    { kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 140 },
  ], note: '<script>not HTML</script>' }] },
  { kind: 'step', id: 'manual', purpose: 'cooldown', ending: { kind: 'manual' }, targets: [] },
] };

describe('WorkoutProfileComponent', () => {
  let theme: ReturnType<typeof signal<AppThemes>>;
  let haptics: { selection: ReturnType<typeof vi.fn> };
  let loader: { init: ReturnType<typeof vi.fn>; setOption: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>; subscribeToViewportResize: ReturnType<typeof vi.fn> };
  let chart: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; isDisposed: ReturnType<typeof vi.fn>; dispatchAction: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    theme = signal(AppThemes.Normal);
    haptics = { selection: vi.fn() };
    chart = { on: vi.fn(), off: vi.fn(), isDisposed: vi.fn(() => false), dispatchAction: vi.fn() };
    loader = { init: vi.fn().mockResolvedValue(chart), setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn(),
      attachMobileSeriesTapFeedback: vi.fn(() => () => undefined), subscribeToViewportResize: vi.fn(() => () => undefined) };
    await TestBed.configureTestingModule({ imports: [WorkoutProfileComponent], providers: [
      { provide: AppThemeService, useValue: { appTheme: theme } }, { provide: AppHapticsService, useValue: haptics },
      { provide: EChartsLoaderService, useValue: loader }, { provide: LoggerService, useValue: { error: vi.fn() } },
    ] }).compileComponents();
  });
  async function render(collapsed = false) {
    const fixture = TestBed.createComponent(WorkoutProfileComponent);
    fixture.componentRef.setInput('structure', structure);
    fixture.componentRef.setInput('contextKey', 'owner/workout/1');
    fixture.componentRef.setInput('initiallyExpanded', !collapsed);
    fixture.detectChanges(); await fixture.whenStable();
    if (!collapsed) await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalled());
    return fixture;
  }

  it('loads charts on disclosure only, follows theme changes and disposes without hydration feedback', async () => {
    const fixture = await render(true);
    expect(loader.init).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('section').hidden).toBe(true);
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(loader.init).toHaveBeenCalled());
    expect(loader.init).toHaveBeenLastCalledWith(fixture.nativeElement.querySelector('.profile-chart'), 'light', undefined);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    theme.set(AppThemes.Dark); fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(loader.init).toHaveBeenLastCalledWith(fixture.nativeElement.querySelector('.profile-chart'), 'dark', undefined));
    expect(loader.init).toHaveBeenLastCalledWith(fixture.nativeElement.querySelector('.profile-chart'), 'dark', undefined);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.componentInstance.toggleExpanded(); fixture.detectChanges();
    expect(loader.dispose).toHaveBeenCalledWith(chart);
    fixture.destroy();
  });

  it('associates keyboard and chart selections with canonical step IDs and unique repeat occurrences, once per accepted action', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    const emit = vi.spyOn(component.stepSelected, 'emit');
    const buttons = fixture.nativeElement.querySelectorAll('[data-profile-index]');
    expect(haptics.selection).not.toHaveBeenCalled();
    buttons[0].click(); buttons[0].click(); fixture.detectChanges();
    expect(emit).toHaveBeenLastCalledWith({ occurrenceKey: 'set/1/warmup', stepId: 'warmup', repeatId: 'set', iteration: 1 });
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); fixture.detectChanges();
    expect(document.activeElement).toBe(buttons[1]);
    expect(component.selected()?.occurrenceKey).toBe('set/2/warmup');
    const click = chart.on.mock.calls.find(call => call[0] === 'click')[1];
    click({ value: [2, .5], data: { occurrenceKey: 'root/1/manual' } });
    click({ value: [2, .5], data: { occurrenceKey: 'root/1/manual' } }); fixture.detectChanges();
    expect(component.selected()?.stepId).toBe('manual');
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Manual transition');
  });

  it('changes metric through Material semantic events and clears context without feedback or stale details', async () => {
    const fixture = await render();
    const select = fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
    select.selectionChange.emit({ source: select, value: 'heart-rate' });
    select.selectionChange.emit({ source: select, value: 'heart-rate' });
    fixture.componentInstance.selectStep(fixture.componentInstance.steps()[0]);
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.metric()).toBe('heart-rate');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    fixture.componentRef.setInput('contextKey', 'new-owner/workout/1'); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    fixture.componentRef.setInput('structure', null); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.profile-chart')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Enter valid workout step details');
  });

  it('preserves the first tap tooltip across selection but dismisses it when target content changes', async () => {
    const fixture = await render();
    const hiddenCount = () => chart.dispatchAction.mock.calls.filter(call => call[0]?.type === 'hideTip').length;
    const initial = hiddenCount();
    fixture.componentInstance.selectStep(fixture.componentInstance.steps()[0]);
    fixture.detectChanges(); await fixture.whenStable();
    expect(hiddenCount()).toBe(initial);
    fixture.componentInstance.selectMetric('heart-rate'); fixture.detectChanges(); await fixture.whenStable();
    expect(hiddenCount()).toBeGreaterThan(initial);
  });

  it('uses canonical occurrence identity for delayed chart events after reordering and ignores removed steps', async () => {
    const fixture = await render();
    const click = chart.on.mock.calls.find(call => call[0] === 'click')[1];
    fixture.componentRef.setInput('structure', { ...structure, nodes: [...structure.nodes].reverse() });
    fixture.detectChanges();
    click({ value: [2, .5], data: { occurrenceKey: 'root/1/manual' } });
    expect(fixture.componentInstance.selected()).toMatchObject({ stepId: 'manual', ordinal: 1 });
    click({ value: [0, .5], data: { occurrenceKey: 'deleted/1/step' } });
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('escapes notes in text and tooltips, marks changed canonical IDs and renders equal targets as rectangles', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('changedStepIds', ['set']); fixture.detectChanges(); await fixture.whenStable();
    fixture.componentInstance.selectStep(fixture.componentInstance.steps()[0]); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('<script>not HTML</script>');
    expect(fixture.nativeElement.textContent).toContain('Changed');
    const option = loader.setOption.mock.calls.at(-1)[1];
    expect(option.series[0].data[0].value).toEqual([0, 200, 200]);
    const item = option.series[0].renderItem({}, { value: (i: number) => [0, 200, 200][i], coord: () => [50, 50], size: () => [40, 0] });
    expect(item.type).toBe('rect'); expect(item.shape.height).toBe(4);
    const tooltip = option.tooltip.formatter({ value: [0] });
    expect(tooltip).toContain('&lt;script&gt;'); expect(tooltip).not.toContain('<script>');
  });

  it('drills through the last pass of a large repeat without changing the recipe or losing step identity', async () => {
    const fixture = await render();
    const large = structuredClone(structure);
    large.nodes[0] = { kind: 'repeat', id: 'set', count: 100, steps: [
      { kind: 'step', id: 'a', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] },
      { kind: 'step', id: 'b', purpose: 'recovery', ending: { kind: 'manual' }, targets: [] },
    ] };
    const before = JSON.stringify(large);
    fixture.componentRef.setInput('structure', large); fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    component.selectStep(component.steps()[0]); component.selectRepeatPass('set', 100); component.selectRepeatPass('set', 100);
    fixture.detectChanges();
    expect(component.selected()).toMatchObject({ occurrenceKey: 'set/100/a', ordinal: 199 });
    expect(fixture.nativeElement.textContent).toContain('201 step occurrences');
    expect(component.steps()).toHaveLength(3); expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(large)).toBe(before);
  });

  it('keeps the selected repeat occurrence when edits cross the grouping budget', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component.selectStep(component.steps()[1]);
    fixture.detectChanges(); await fixture.whenStable();
    const large = structuredClone(structure);
    large.nodes[0] = { kind: 'repeat', id: 'set', count: 100, steps: [
      ...(large.nodes[0].kind === 'repeat' ? large.nodes[0].steps : []),
      { kind: 'step', id: 'recovery', purpose: 'recovery', ending: { kind: 'time', seconds: 60 }, targets: [] },
    ] };
    fixture.componentRef.setInput('structure', large);
    fixture.detectChanges(); await fixture.whenStable();
    expect(component.model().grouped).toBe(true);
    expect(component.model().repeats[0].iteration).toBe(2);
    expect(component.selected()).toMatchObject({ occurrenceKey: 'set/2/warmup', ordinal: 3 });
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('shows authored instructions when the only pace target has no finite range', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('structure', { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'open-pace', purpose: 'work', ending: { kind: 'manual' }, targets: [
        { kind: 'speed', mode: 'relative', minimumPercent: 0, maximumPercent: 100,
          presentation: 'pace', reference: { kind: 'threshold-speed', metersPerSecond: 4 } },
      ] },
    ] });
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.model()).not.toBeNull();
    expect(fixture.componentInstance.metric()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('0–100%');
    expect(fixture.nativeElement.textContent).toContain('No finite pace range');
    expect(fixture.nativeElement.textContent).not.toContain('No target prescribed');
    expect(fixture.componentInstance.summary()).toContain('No finite target ranges to plot');
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('remembers a new selection after a repeat shrinks past the previously chosen pass', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    const large = structuredClone(structure);
    large.nodes[0] = { kind: 'repeat', id: 'set', count: 100, steps: [
      ...(large.nodes[0].kind === 'repeat' ? large.nodes[0].steps : []),
      { kind: 'step', id: 'recovery', purpose: 'recovery', ending: { kind: 'manual' }, targets: [] },
    ] };
    fixture.componentRef.setInput('structure', large); fixture.detectChanges(); await fixture.whenStable();
    component.selectStep(component.steps()[0]); component.selectRepeatPass('set', 100);
    fixture.detectChanges(); await fixture.whenStable();
    const smaller = structuredClone(large);
    if (smaller.nodes[0].kind === 'repeat') smaller.nodes[0].count = 70;
    fixture.componentRef.setInput('structure', smaller); fixture.detectChanges(); await fixture.whenStable();
    expect(component.selected()).toBeNull();
    const hidden = chart.dispatchAction.mock.calls.filter(call => call[0]?.type === 'hideTip').length;
    component.selectStep(component.steps()[0]); fixture.detectChanges(); await fixture.whenStable();
    expect(chart.dispatchAction.mock.calls.filter(call => call[0]?.type === 'hideTip')).toHaveLength(hidden);
    fixture.componentRef.setInput('structure', large); fixture.detectChanges(); await fixture.whenStable();
    expect(component.selected()).toMatchObject({ occurrenceKey: 'set/1/warmup' });
    expect(component.model().repeats[0].iteration).toBe(1);
  });
});
