import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { defaultDayWorkoutControls } from '@shared/day-workout';
import { MorningWorkoutComponent } from './morning-workout.component';
import { MorningWorkoutService } from '../../../services/morning-workout.service';
import { DayWorkoutService } from '../../../services/day-workout.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { AppUserService } from '../../../services/app.user.service';


function exportQa(element: HTMLElement, name: string) {
  const dir = process.env.MORNING_WORKOUT_QA_DIR; if (!dir) return;
  const sass = createRequire(createRequire(resolve('package.json')).resolve('@angular/build/package.json'))('sass');
  const css = ['summaries/morning-workout/morning-workout', 'shared/compact-row/compact-row'].map(path => {
    const tag = path.split('/').at(-1);
    return sass.compileString(`app-${tag} {` + readFileSync(`src/app/components/${path}.component.scss`, 'utf8')
      .replace(/:host\(([^)]+)\)/g, '&$1').replace(/:host/g, '&') + '}').css;
  }).join('');
  for (const dark of [false, true]) writeFileSync(join(dir, `${name}${dark ? '-dark' : ''}.html`),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="stylesheet" href="styles.css">' + [...document.head.querySelectorAll('style')].map(style => style.outerHTML).join('')
    + '<style>' + css + '</style></head><body class="app-hydrated' + (dark ? ' dark-theme' : '')
    + '"><main class="qs-workspace-page"><h2>Today</h2><p>Friday, 30 October 2026</p>'
    + '<p>Good morning — training state is Fresh, readiness is Mixed.</p><p>Training state · Fresh &nbsp; Readiness · Mixed</p>'
    + element.outerHTML + '</main></body></html>');
}

let restoreVisibility = () => {};
function setup(enabled = true) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(new Date('2026-10-30T07:00Z'));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  restoreVisibility = () => visibility.mockRestore();
  const preferences = signal({ enabled, followRoutine: true, controls: defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki') });
  const owner = signal('owner'), pro = signal(true), saving = signal(false);
  const result = { requestId: 'morning:2026-10-30', observedAt: '2026-10-30T07:00Z', kind: 'rest', rationale: 'An easy day.', draft: null,
    usedContext: [], missingContext: [], previousLoads: [] };
  const request = vi.fn(async (_uid, action) => action === 'status' ? { localDate: '2026-10-30', state: 'waiting' }
    : { localDate: '2026-10-30', state: action === 'dismiss' ? 'dismissed' : 'ready', controls: preferences().controls, result });
  const event = vi.fn(), save = vi.fn(async (_uid, value) => { preferences.set(value); });
  const open = vi.fn().mockResolvedValue(undefined);
  const haptics = { success: vi.fn(), error: vi.fn(), selection: vi.fn() };
  TestBed.configureTestingModule({ imports: [MorningWorkoutComponent], providers: [
    { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
    { provide: MorningWorkoutService, useValue: { preferences, saving, eligible: (uid: string) => uid === owner() && pro(), isOwner: (uid: string) => uid === owner(), request, event, save } },
    { provide: DayWorkoutService, useValue: { open } }, { provide: AppHapticsService, useValue: haptics },
    { provide: AppUserService, useValue: { user: signal({ settings: { unitSettings: {} } }) } },
  ] });
  const fixture = TestBed.createComponent(MorningWorkoutComponent);
  fixture.componentRef.setInput('ownerUid', 'owner'); fixture.componentRef.setInput('localDate', '2026-10-30');
  fixture.componentRef.setInput('dataReady', true); fixture.detectChanges();
  const setVisible = (visible: boolean) => {
    visibility.mockReturnValue(visible ? 'visible' : 'hidden');
    document.dispatchEvent(new Event('visibilitychange')); fixture.detectChanges();
  };
  return { fixture, preferences, owner, pro, saving, request, event, save, open, haptics, setVisible };
}
afterEach(() => { vi.useRealTimers(); restoreVisibility(); });
describe('compact morning workout in Today', () => {
  it('stays off by default and does no private reads for free or shared dashboards', async () => {
    const { fixture, request, pro } = setup(false);
    expect(fixture.nativeElement.textContent).toContain('Set up'); exportQa(fixture.nativeElement, 'morning-setup');
    await vi.advanceTimersByTimeAsync(1600); expect(request).not.toHaveBeenCalled();
    pro.set(false); fixture.detectChanges(); expect(fixture.nativeElement.textContent.trim()).toBe('');
  });
  it('waits for preference write acknowledgement before reading an optimistic local settings echo', async () => {
    const { fixture, request, saving } = setup(); saving.set(true); fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(1600); expect(request).not.toHaveBeenCalled();
    saving.set(false); fixture.detectChanges(); await vi.advanceTimersByTimeAsync(1600);
    expect(request.mock.calls.map(call => call[1])).toEqual(['status', 'prepare']);
  });
  it('waits for Today data, prepares once, and opens the existing review without saving', async () => {
    const { fixture, request, event, open, haptics } = setup();
    fixture.componentRef.setInput('dataReady', false); fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(1600); expect(request).not.toHaveBeenCalled();
    fixture.componentRef.setInput('dataReady', true); fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(request.mock.calls.map(call => call[1])).toEqual(['status', 'prepare']);
    expect(fixture.nativeElement.textContent).toContain('A recovery day'); exportQa(fixture.nativeElement, 'morning-rest'); expect(haptics.success).not.toHaveBeenCalled();
    const value = fixture.componentInstance.status()!;
    fixture.componentInstance.status.set({ ...value, result: { ...value.result!, kind: 'workout', draft: {
      title: 'Easy run', structure: { version: 1, sport: value.controls!.sport, nodes: [{ kind: 'step', id: 'easy', purpose: 'work',
        ending: { kind: 'time', seconds: 1800 }, targets: [], note: 'Comfortable effort' }] },
    } } });
    fixture.detectChanges(); exportQa(fixture.nativeElement, 'morning-ready');
    await fixture.componentInstance.review();
    expect(open).toHaveBeenCalledWith('owner', '2026-10-30', expect.any(String), expect.objectContaining({ initialResult: expect.any(Object), onAdded: expect.any(Function) }));
    expect(event).toHaveBeenCalledWith('owner', 'reviewed', 'ready');
    expect(event).not.toHaveBeenCalledWith('owner', 'added', 'ready');
  });
  it('drops late replies after account changes and destroy', async () => {
    const { fixture, request, owner } = setup(); let resolve!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = fixture.componentInstance.load(); owner.set('other'); fixture.detectChanges();
    resolve({ localDate: '2026-10-30', state: 'ready' }); await pending; fixture.detectChanges();
    expect(fixture.componentInstance.status()).toBeNull();
    fixture.destroy(); await vi.advanceTimersByTimeAsync(1600); expect(request).toHaveBeenCalledOnce();
  });
  it.each(['day', 'account'] as const)('shows an added workout and fences its callback after a %s change', async change => {
    const { fixture, open, preferences, owner, event } = setup();
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    const ready = fixture.componentInstance.status()!;
    fixture.componentInstance.status.set({ ...ready, result: { ...ready.result!, kind: 'workout', draft: {
      title: 'Easy run', structure: { version: 1, sport: ready.controls!.sport, nodes: [{ kind: 'step', id: 'easy', purpose: 'work',
        ending: { kind: 'time', seconds: 1800 }, targets: [] }] },
    } } });
    await fixture.componentInstance.review();
    const onAdded = open.mock.calls[0][3].onAdded;
    onAdded();
    expect(fixture.componentInstance.status()).toEqual({ localDate: '2026-10-30', state: 'planned' });
    const nextDate = change === 'day' ? '2026-10-31' : '2026-10-30';
    if (change === 'day') {
      preferences.update(value => ({ ...value, controls: { ...value.controls, localDate: nextDate } }));
      fixture.componentRef.setInput('localDate', nextDate);
    } else { owner.set('other'); fixture.componentRef.setInput('ownerUid', 'other'); }
    fixture.detectChanges();
    fixture.componentInstance.status.set({ localDate: nextDate, state: 'completed' });
    onAdded();
    expect(fixture.componentInstance.status()).toEqual({ localDate: nextDate, state: 'completed' });
    expect(event).toHaveBeenCalledWith('owner', 'added', 'ready');
  });
  it('uses saved source opt-outs in preferences and keeps disable available after dismissal', async () => {
    const { fixture, open, request, save, event } = setup();
    await fixture.componentInstance.configure();
    const config = open.mock.calls[0][3]; expect(config.mode).toBe('preferences');
    await config.savePreferences({ ...config.initialControls, timelineContext: false }, false);
    expect(save).toHaveBeenCalledWith('owner', expect.objectContaining({ enabled: true, followRoutine: false, controls: expect.objectContaining({ timelineContext: false }) }));
    expect(event).toHaveBeenCalledWith('owner', 'preferences_saved');
    expect(event).not.toHaveBeenCalledWith('owner', 'enabled');
    fixture.detectChanges();
    await fixture.componentInstance.dismiss(); fixture.detectChanges();
    expect(request).toHaveBeenCalledWith('owner', 'dismiss', expect.any(Function), '2026-10-30');
    expect(fixture.nativeElement.textContent).toContain('Dismissed for today');
    expect(fixture.nativeElement.querySelector('[aria-label="Morning workout options"]')).toBeTruthy();
  });
  it.each([false, true])('keeps disable feedback through settings effects (failure: %s)', async fail => {
    const { fixture, save, saving, preferences, haptics, event, request } = setup();
    let finish!: () => void;
    save.mockImplementationOnce(async (_uid, value) => {
      saving.set(true); await new Promise<void>(resolve => { finish = resolve; });
      saving.set(false); if (fail) throw Error('Write rejected'); preferences.set(value);
    });
    const pending = fixture.componentInstance.disable(); fixture.detectChanges();
    expect(fixture.componentInstance.busy()).toBe(true);
    await vi.advanceTimersByTimeAsync(1600); expect(request).not.toHaveBeenCalled();
    finish(); await pending; fixture.detectChanges();
    expect(fixture.componentInstance.busy()).toBe(false);
    if (fail) {
      expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('could not be saved');
      expect(haptics.error).toHaveBeenCalledOnce(); expect(event).not.toHaveBeenCalledWith('owner', 'disabled');
    } else { expect(haptics.success).toHaveBeenCalledOnce(); expect(event).toHaveBeenCalledWith('owner', 'disabled'); }
  });
  it('does not let an automatic refresh supersede a dismiss action', async () => {
    const { fixture, request, haptics } = setup(); let finish!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fixture.componentInstance.dismiss();
    await vi.advanceTimersByTimeAsync(1600);
    expect(request).toHaveBeenCalledOnce();
    finish({ localDate: '2026-10-30', state: 'dismissed' }); await pending; fixture.detectChanges();
    expect(fixture.componentInstance.status()?.state).toBe('dismissed'); expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('drops action feedback after a day or account changes', async () => {
    const { fixture, request, preferences, haptics } = setup(); let finish!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fixture.componentInstance.dismiss();
    preferences.update(value => ({ ...value, controls: { ...value.controls, localDate: '2026-10-31' } }));
    fixture.componentRef.setInput('localDate', '2026-10-31'); fixture.detectChanges();
    finish({ localDate: '2026-10-30', state: 'dismissed' }); await pending;
    expect(haptics.success).not.toHaveBeenCalled(); expect(fixture.componentInstance.status()).toBeNull();
  });
  it('waits without polling, retries on Sleep changes, and leaves a ready suggestion unchanged', async () => {
    const { fixture, request, haptics } = setup(); let synced = false;
    const ready = await request('owner', 'prepare'); request.mockClear();
    request.mockImplementation(async (_uid, action) => synced && action === 'prepare' ? ready : { localDate: '2026-10-30', state: 'waiting-sleep' } as any);
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Waiting for your latest sleep'); exportQa(fixture.nativeElement, 'morning-waiting');
    const attempts = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000); expect(request).toHaveBeenCalledTimes(attempts);
    synced = true; fixture.componentRef.setInput('sleepRevision', 1); fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(fixture.componentInstance.status()?.state).toBe('ready'); expect(haptics.success).not.toHaveBeenCalled();
    const completed = request.mock.calls.length;
    fixture.componentRef.setInput('sleepRevision', 2); fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(1600); expect(request).toHaveBeenCalledTimes(completed);
  });
  it('notices Sleep arriving during an in-flight context read and coalesces the follow-up', async () => {
    const { fixture, request } = setup(); let finish!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fixture.componentInstance.load();
    fixture.componentRef.setInput('sleepRevision', 1); fixture.detectChanges();
    finish({ localDate: '2026-10-30', state: 'waiting-sleep' });
    request.mockResolvedValueOnce({ localDate: '2026-10-30', state: 'waiting-sleep' } as any);
    await pending; fixture.detectChanges();
    const attempts = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(request.mock.calls.length).toBeGreaterThan(attempts);
    expect(fixture.componentInstance.status()?.state).toBe('ready');
  });
  it('retains an in-flight result while Today readiness reloads without issuing another request', async () => {
    const { fixture, request } = setup();
    const ready = await request('owner', 'prepare'); request.mockClear();
    let finish!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fixture.componentInstance.load();
    fixture.componentRef.setInput('dataReady', false); fixture.detectChanges();
    fixture.componentRef.setInput('sleepRevision', 1);
    fixture.componentRef.setInput('dataReady', true); fixture.detectChanges();
    finish(ready); await pending; fixture.detectChanges();
    expect(fixture.componentInstance.status()?.state).toBe('ready');
    await vi.advanceTimersByTimeAsync(1600);
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(['ready', 'planned', 'completed', 'rest-day', 'dismissed', 'failed', 'preparing', 'waiting-sleep'] as const)(
    'keeps the %s row through tab switches without another API read', async state => {
      const { fixture, request, setVisible } = setup();
      const ready = await request('owner', 'prepare'); request.mockClear();
      request.mockResolvedValue({ ...ready, state } as any);
      await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
      const status = fixture.componentInstance.status(), summary = fixture.componentInstance.summary();
      const attempts = request.mock.calls.length;
      for (let visit = 0; visit < 3; visit++) {
        setVisible(false);
        expect(fixture.componentInstance.status()).toBe(status);
        setVisible(true); await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
        expect(fixture.componentInstance.status()).toBe(status);
        expect(fixture.componentInstance.summary()).toBe(summary);
        expect(fixture.componentInstance.busy()).toBe(false);
      }
      fixture.componentRef.setInput('dataReady', false); fixture.detectChanges();
      fixture.componentRef.setInput('dataReady', true); fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(1600);
      expect(request).toHaveBeenCalledTimes(attempts);
    });
  it('retains a read that finishes in a hidden tab and counts it shown on return', async () => {
    const { fixture, request, event, setVisible } = setup();
    const ready = await request('owner', 'prepare'); request.mockClear();
    let finish!: (value: typeof ready) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fixture.componentInstance.load(); setVisible(false);
    expect(fixture.componentInstance.busy()).toBe(true);
    finish(ready); await pending; fixture.detectChanges();
    expect(fixture.componentInstance.status()).toBe(ready);
    expect(event).not.toHaveBeenCalledWith('owner', 'shown', 'ready');
    setVisible(true); await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(request).toHaveBeenCalledOnce();
    expect(event).toHaveBeenCalledExactlyOnceWith('owner', 'shown', 'ready');
  });
  it('coalesces Sleep changes while hidden into one check on return', async () => {
    const { fixture, request, setVisible } = setup();
    const ready = await request('owner', 'prepare'); request.mockClear();
    request.mockResolvedValue({ localDate: '2026-10-30', state: 'waiting-sleep' } as any);
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    request.mockClear(); setVisible(false);
    fixture.componentRef.setInput('sleepRevision', 1); fixture.detectChanges();
    fixture.componentRef.setInput('sleepRevision', 2); fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(1600); expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue(ready); setVisible(true);
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(request).toHaveBeenCalledExactlyOnceWith('owner', 'status', expect.any(Function));
    expect(fixture.componentInstance.status()).toBe(ready);
  });
  it.each(['waiting', 'waiting-sleep'] as const)('defers %s preparation when its status read finishes hidden', async state => {
    const { fixture, request, setVisible } = setup();
    let finish!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fixture.componentInstance.load(); setVisible(false);
    finish({ localDate: '2026-10-30', state }); await pending; fixture.detectChanges();
    expect(request.mock.calls.map(call => call[1])).toEqual(['status']);
    expect(fixture.componentInstance.status()?.state).toBe(state);
    setVisible(true); await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(request.mock.calls.map(call => call[1])).toEqual(['status', 'status', 'prepare']);
    expect(fixture.componentInstance.status()?.state).toBe('ready');
    setVisible(false); setVisible(true); await vi.advanceTimersByTimeAsync(1600);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('keeps a failed read stable on tab return and allows an explicit retry', async () => {
    const { fixture, request, setVisible } = setup();
    request.mockRejectedValueOnce(Error('Offline'));
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe(true);
    setVisible(false); setVisible(true); await vi.advanceTimersByTimeAsync(1600);
    expect(request).toHaveBeenCalledOnce();
    await fixture.componentInstance.load(); fixture.detectChanges();
    expect(fixture.componentInstance.status()?.state).toBe('ready');
    expect(fixture.componentInstance.error()).toBe(false);
  });
  it('can start the morning window after an earlier same-day visit', async () => {
    const { fixture, request, setVisible } = setup();
    vi.setSystemTime(new Date('2026-10-30T02:00Z'));
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(request.mock.calls.map(call => call[1])).toEqual(['status']);
    expect(fixture.componentInstance.status()?.state).toBe('waiting');
    setVisible(false); vi.setSystemTime(new Date('2026-10-30T04:00Z')); setVisible(true);
    await vi.advanceTimersByTimeAsync(1600); fixture.detectChanges();
    expect(request.mock.calls.map(call => call[1])).toEqual(['status', 'status', 'prepare']);
    expect(fixture.componentInstance.status()?.state).toBe('ready');
  });
  it('still retires in-flight reads when personalization changes', async () => {
    const { fixture, request, preferences } = setup();
    const ready = await request('owner', 'prepare'); request.mockClear();
    let finish!: (value: any) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fixture.componentInstance.load();
    preferences.update(value => ({ ...value, controls: { ...value.controls, timelineContext: false } }));
    fixture.detectChanges(); finish(ready); await pending;
    expect(fixture.componentInstance.status()).toBeNull();
  });
  it('retains the waiting row but disables generation while readiness is loading again', () => {
    const { fixture, request } = setup();
    fixture.componentInstance.status.set({ localDate: '2026-10-30', state: 'waiting-sleep' });
    fixture.componentRef.setInput('dataReady', false); fixture.detectChanges();
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((item: HTMLButtonElement) => item.textContent?.includes('Use available data')) as HTMLButtonElement;
    expect(button.disabled).toBe(true); button.click(); expect(request).not.toHaveBeenCalled();
    fixture.componentRef.setInput('dataReady', true); fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });
  it('uses the dated included fallback only after an explicit click, including after noon', async () => {
    const { fixture, request } = setup();
    fixture.componentInstance.status.set({ localDate: '2026-10-30', state: 'waiting-sleep' });
    fixture.detectChanges(); vi.setSystemTime(new Date('2026-10-30T13:00Z'));
    fixture.componentRef.setInput('sleepRevision', 1); fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(1600);
    expect(request.mock.calls.every(call => call[1] === 'status')).toBe(true);
    fixture.componentInstance.status.set({ localDate: '2026-10-30', state: 'waiting-sleep' }); fixture.detectChanges();
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((item: HTMLButtonElement) => item.textContent?.includes('Use available data')) as HTMLButtonElement;
    button.click(); await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenLastCalledWith('owner', 'use-available-data', expect.any(Function), '2026-10-30');
    expect(fixture.componentInstance.status()?.state).toBe('ready');
  });

});
