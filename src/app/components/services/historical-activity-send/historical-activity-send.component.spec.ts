import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ServiceNames } from '@sports-alliance/sports-lib';
import dayjs from 'dayjs';
import 'dayjs/locale/en-gb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { HistoricalActivitySendComponent } from './historical-activity-send.component';
import { MatDayjsDateModule } from '../../../shared/adapters/mat-dayjs-date.module';

describe('HistoricalActivitySendComponent', () => {
  const userService = { historicalSendActivityPage: vi.fn() };
  const haptics = { selection: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const snackBar = { open: vi.fn() };
  let component: HistoricalActivitySendComponent;
  let fixture: ComponentFixture<HistoricalActivitySendComponent>;

  function configureComponent(destination = ServiceNames.SuuntoApp): void {
    component.user = { uid: 'user-1' } as never;
    component.destinationServiceName = destination;
    component.destinationConnected = true;
    component.hasProAccess = true;
    component.ngOnChanges({ destinationServiceName: {} as never, user: {} as never });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      declarations: [HistoricalActivitySendComponent],
      imports: [FormsModule, MatDayjsDateModule, MatDatepickerModule, MatInputModule,
        MatButtonModule, MatCheckboxModule, MatProgressSpinnerModule],
      providers: [
        { provide: MAT_DATE_LOCALE, useValue: 'en-GB' },
        { provide: AppUserService, useValue: userService },
        { provide: AppHapticsService, useValue: haptics },
        { provide: MatSnackBar, useValue: snackBar },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    component = TestBed.runInInjectionContext(() => new HistoricalActivitySendComponent());
    configureComponent();
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([ServiceNames.SuuntoApp, ServiceNames.WahooAPI, ServiceNames.COROSAPI])(
    'enables preview and then send after entering dates through the app datepicker for %s', async destination => {
      fixture = TestBed.createComponent(HistoricalActivitySendComponent);
      component = fixture.componentInstance;
      configureComponent(destination);
      component.onSourceChange(component.sourceOptions.find(option => option.id === 'manualUpload')!, true);
      fixture.detectChanges();
      await fixture.whenStable();

      const inputs: NodeListOf<HTMLInputElement> = fixture.nativeElement.querySelectorAll('input');
      for (const [index, text] of ['01/01/2025', '10/01/2025'].entries()) {
        inputs[index].value = text;
        inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
        fixture.detectChanges();
        await fixture.whenStable();
      }
      expect(dayjs.isDayjs(component.startDate)).toBe(true);
      expect(dayjs.isDayjs(component.endDate)).toBe(true);
      expect(component.canPreview).toBe(true);
      const actionButtons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.historical-send__actions button');
      expect(actionButtons[0].disabled).toBe(false);
      expect(actionButtons[1].disabled).toBe(true);

      const response = { scanned: 1, eligibleBySource: { manualUpload: 1 }, skippedBySource: {}, queued: 0,
        skippedByReason: {}, failedCount: 0, nextCursor: null };
      userService.historicalSendActivityPage.mockResolvedValueOnce(response);
      actionButtons[0].click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.canSend).toBe(true);
      expect(actionButtons[1].disabled).toBe(false);

      userService.historicalSendActivityPage.mockResolvedValueOnce({ ...response, queued: 1 });
      actionButtons[1].click();
      await fixture.whenStable();
      expect(userService.historicalSendActivityPage.mock.calls[1][0]).toMatchObject({
        action: 'send', destinationServiceName: destination,
        startDate: new Date(2025, 0, 1, 0, 0, 0, 0).toISOString(),
        endDate: new Date(2025, 0, 10, 23, 59, 59, 999).toISOString(),
      });
    },
  );

  it.each([
    { zone: 'Europe/Helsinki', date: '2025-03-30', start: '2025-03-29T22:00:00.000Z', end: '2025-03-30T20:59:59.999Z' },
    { zone: 'America/New_York', date: '2025-03-09', start: '2025-03-09T05:00:00.000Z', end: '2025-03-10T03:59:59.999Z' },
  ])('includes the entire selected local day across DST in $zone', async ({ zone, date, start, end }) => {
    vi.stubEnv('TZ', zone);
    component.startDate = dayjs(`${date}T15:00:00`);
    component.endDate = dayjs(`${date}T08:00:00`);
    component.onSourceChange(component.sourceOptions[3], true);
    expect(component.canPreview).toBe(true);
    userService.historicalSendActivityPage.mockResolvedValueOnce({ scanned: 0, eligibleBySource: {},
      skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0, nextCursor: null });
    await component.runPreview();
    expect(userService.historicalSendActivityPage).toHaveBeenCalledWith(expect.objectContaining({ startDate: start, endDate: end }));
    expect(component.startDate.hour()).toBe(15);
    expect(component.endDate.hour()).toBe(8);
    expect(component.canSend).toBe(false);
  });

  it.each(['missing-start', 'missing-end', 'invalid-start', 'invalid-end', 'reversed', 'future'])(
    'blocks preview and sending for a %s date range', async invalid => {
      component.onSourceChange(component.sourceOptions[3], true);
      if (invalid === 'missing-start') component.startDate = null;
      if (invalid === 'missing-end') component.endDate = null;
      if (invalid === 'invalid-start') component.startDate = dayjs('invalid');
      if (invalid === 'invalid-end') component.endDate = dayjs('invalid');
      if (invalid === 'reversed') component.startDate = component.today.add(1, 'day');
      if (invalid === 'future') component.endDate = component.today.add(1, 'day');
      haptics.selection.mockClear();
      component.onDateInput();
      await component.runPreview();
      await component.runSend();
      expect(component.canPreview).toBe(false);
      expect(component.canSend).toBe(false);
      expect(userService.historicalSendActivityPage).not.toHaveBeenCalled();
      expect(haptics.selection).not.toHaveBeenCalled();
    },
  );

  it('clears the eligible preview after a date change and requires the new range to be previewed', async () => {
    component.onSourceChange(component.sourceOptions[3], true);
    userService.historicalSendActivityPage.mockResolvedValue({ scanned: 1, eligibleBySource: { manualUpload: 1 },
      skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0, nextCursor: null });
    await component.runPreview();
    expect(component.canSend).toBe(true);
    component.endDate = component.today.subtract(1, 'day');
    expect(component.canSend).toBe(false);
    component.onDateInput();
    expect(component.preview()).toBeNull();
    expect(component.previewSignature()).toBeNull();
    await component.runSend();
    expect(userService.historicalSendActivityPage).toHaveBeenCalledTimes(1);
    await component.runPreview();
    expect(component.canSend).toBe(true);
  });

  it('clears the preview immediately while typing, even if the original date is typed again', async () => {
    fixture = TestBed.createComponent(HistoricalActivitySendComponent);
    component = fixture.componentInstance;
    configureComponent();
    component.onSourceChange(component.sourceOptions[3], true);
    fixture.detectChanges();
    await fixture.whenStable();
    userService.historicalSendActivityPage.mockResolvedValueOnce({ scanned: 1, eligibleBySource: { manualUpload: 1 },
      skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0, nextCursor: null });
    await component.runPreview();
    fixture.detectChanges();
    expect(component.canSend).toBe(true);
    haptics.selection.mockClear();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    const original = input.value;
    for (const value of ['not a date', original]) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.preview()).toBeNull();
      expect(component.canSend).toBe(false);
    }
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('requires a new eligible result after a repeat preview fails', async () => {
    component.onSourceChange(component.sourceOptions[3], true);
    userService.historicalSendActivityPage.mockResolvedValueOnce({ scanned: 1, eligibleBySource: { manualUpload: 1 },
      skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0, nextCursor: null });
    await component.runPreview();
    expect(component.canSend).toBe(true);
    userService.historicalSendActivityPage.mockRejectedValueOnce(new Error('temporary failure'));
    await component.runPreview();
    expect(component.error()).toBe('Could not preview past activities.');
    expect(component.preview()).toBeNull();
    expect(component.previewSignature()).toBeNull();
    expect(component.canSend).toBe(false);
    await component.runSend();
    expect(userService.historicalSendActivityPage).toHaveBeenCalledTimes(2);
  });

  it.each(['not a date', '31/09/2025', '29/02/2025'])(
    'shows a field error for invalid typed date %s without requesting a preview', async value => {
      fixture = TestBed.createComponent(HistoricalActivitySendComponent);
      component = fixture.componentInstance;
      configureComponent();
      component.onSourceChange(component.sourceOptions[3], true);
      fixture.detectChanges();
      await fixture.whenStable();
      const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
      haptics.selection.mockClear();
      input.value = value;
      for (const type of ['input', 'change', 'blur']) input.dispatchEvent(new Event(type, { bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.startDate).toBeNull();
      expect(fixture.nativeElement.querySelector('mat-error')?.textContent).toContain('Choose a valid start date');
      expect(component.canPreview).toBe(false);
      await component.runPreview();
      expect(userService.historicalSendActivityPage).not.toHaveBeenCalled();
      expect(haptics.selection).not.toHaveBeenCalled();
    },
  );

  it('only gives date-selection feedback after the calendar closes with a changed valid date', () => {
    component.onDatePickerOpened();
    component.onDatePickerClosed();
    expect(haptics.selection).not.toHaveBeenCalled();
    component.onDatePickerOpened();
    component.endDate = component.today.subtract(1, 'day');
    component.onDateInput();
    expect(haptics.selection).not.toHaveBeenCalled();
    component.onDatePickerClosed();
    expect(haptics.selection).toHaveBeenCalledOnce();
    component.onDatePickerClosed();
    expect(haptics.selection).toHaveBeenCalledOnce();
    component.onDatePickerOpened();
    component.endDate = null;
    component.onDateInput();
    component.onDatePickerClosed();
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it.each(['destinationConnected', 'hasProAccess'] as const)(
    'discards an in-flight preview when %s is lost and does not reuse it after restoration', async field => {
      component.onSourceChange(component.sourceOptions[3], true);
      let resolvePage!: (value: unknown) => void;
      userService.historicalSendActivityPage.mockReturnValueOnce(new Promise(resolve => { resolvePage = resolve; }));
      const pending = component.runPreview();
      expect(component.busy()).toBe('preview');
      component[field] = false;
      component.ngOnChanges({ [field]: {} as never });
      resolvePage({ scanned: 1, eligibleBySource: { manualUpload: 1 }, skippedBySource: {}, queued: 0,
        skippedByReason: {}, failedCount: 0, nextCursor: null });
      await pending;
      component[field] = true;
      component.ngOnChanges({ [field]: {} as never });
      expect(component.preview()).toBeNull();
      expect(component.canPreview).toBe(true);
      expect(component.canSend).toBe(false);
      expect(haptics.success).not.toHaveBeenCalled();
      await component.runSend();
      expect(userService.historicalSendActivityPage).toHaveBeenCalledTimes(1);
    },
  );

  it('starts with no source selected and keeps manual uploads separate from provider imports', () => {
    expect(component.sourceOptions.map(option => option.id)).toEqual([
      ServiceNames.GarminAPI, ServiceNames.COROSAPI, ServiceNames.WahooAPI, 'manualUpload',
    ]);
    expect(component.selectedSourceCount).toBe(0);
    expect(component.canPreview).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('previews server-owned pages before allowing Send, and invalidates on source changes', async () => {
    component.onSourceChange(component.sourceOptions[3], true);
    userService.historicalSendActivityPage
      .mockResolvedValueOnce({ scanned: 50, eligibleBySource: { manualUpload: 2 }, queued: 0, skippedByReason: { already_sent: 1 }, failedCount: 0,
        nextCursor: { lastStartDate: 1, lastEventID: 'event-50', queryHash: 'hash' } })
      .mockResolvedValueOnce({ scanned: 2, eligibleBySource: { manualUpload: 1 }, queued: 0, skippedByReason: {}, failedCount: 0, nextCursor: null });

    await component.runPreview();

    expect(userService.historicalSendActivityPage).toHaveBeenCalledTimes(2);
    expect(userService.historicalSendActivityPage.mock.calls[0][0]).toMatchObject({
      version: 2, action: 'preview', destinationServiceName: ServiceNames.SuuntoApp, sources: ['manualUpload'],
    });
    expect(userService.historicalSendActivityPage.mock.calls[0][0]).not.toHaveProperty('cursor');
    expect(userService.historicalSendActivityPage.mock.calls[1][0].cursor.lastEventID).toBe('event-50');
    expect(component.preview()?.eligibleBySource.manualUpload).toBe(3);
    expect(component.canSend).toBe(true);
    expect(haptics.success).toHaveBeenCalledOnce();

    component.onSourceChange(component.sourceOptions[0], true);
    expect(component.preview()).toBeNull();
    expect(component.canSend).toBe(false);
  });

  it('sends filters without client-selected event IDs and reports queue admission', async () => {
    component.onSourceChange(component.sourceOptions[3], true);
    userService.historicalSendActivityPage.mockResolvedValueOnce({
      scanned: 1, eligibleBySource: { manualUpload: 1 }, queued: 0, skippedByReason: {}, failedCount: 0, nextCursor: null,
    });
    await component.runPreview();
    userService.historicalSendActivityPage.mockResolvedValueOnce({
      scanned: 1, eligibleBySource: { manualUpload: 1 }, queued: 1, skippedByReason: {}, failedCount: 0, nextCursor: null,
    });

    await component.runSend();

    expect(userService.historicalSendActivityPage.mock.calls[1][0]).toMatchObject({ action: 'send', sources: ['manualUpload'] });
    expect(userService.historicalSendActivityPage.mock.calls[1][0]).not.toHaveProperty('eventIDs');
    expect(component.sendResult()?.queued).toBe(1);
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('1 activities scheduled'), undefined, expect.anything());
    expect(haptics.error).not.toHaveBeenCalled();
  });

  it('renders progress and enables Send after async completion without another user interaction', async () => {
    fixture = TestBed.createComponent(HistoricalActivitySendComponent);
    component = fixture.componentInstance;
    configureComponent(ServiceNames.COROSAPI);
    component.onSourceChange(component.sourceOptions[3], true);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    let resolveLast!: (value: unknown) => void;
    userService.historicalSendActivityPage
      .mockResolvedValueOnce({ scanned: 50, eligibleBySource: { manualUpload: 2 }, skippedBySource: {}, queued: 0,
        skippedByReason: {}, failedCount: 0, nextCursor: { lastStartDate: 1, lastEventID: 'event-50', queryHash: 'hash' } })
      .mockReturnValueOnce(new Promise(resolve => { resolveLast = resolve; }));

    const pending = component.runPreview();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('50 activities checked · 2 eligible so far');
    expect(component.preview()).toBeNull();
    expect(component.canSend).toBe(false);
    expect(haptics.success).not.toHaveBeenCalled();
    resolveLast({ scanned: 1, eligibleBySource: { manualUpload: 1 }, skippedBySource: {}, queued: 0,
      skippedByReason: {}, failedCount: 0, nextCursor: null });
    await pending;
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.historical-send__actions button:last-child').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('app-status-info').textContent).toContain('Activities checked: 51');
    expect(component.progress()).toBeNull();
  });

  it('stops requesting preview pages and discards a late reply without affecting a restarted preview', async () => {
    component.onSourceChange(component.sourceOptions[3], true);
    let resolveOld!: (value: unknown) => void;
    userService.historicalSendActivityPage.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const old = component.runPreview();
    const selectionCount = haptics.selection.mock.calls.length;
    component.stopPreview();
    expect(haptics.selection.mock.calls.length).toBe(selectionCount + 1);
    component.stopPreview();
    expect(haptics.selection.mock.calls.length).toBe(selectionCount + 1);
    expect(component.busy()).toBeNull();
    expect(component.progress()).toBeNull();
    expect(component.canSend).toBe(false);
    userService.historicalSendActivityPage.mockResolvedValueOnce({ scanned: 1, eligibleBySource: { manualUpload: 1 },
      skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0, nextCursor: null });
    await component.runPreview();
    resolveOld({ scanned: 50, eligibleBySource: { manualUpload: 50 }, skippedBySource: {}, queued: 0,
      skippedByReason: {}, failedCount: 0, nextCursor: { lastStartDate: 1, lastEventID: 'old', queryHash: 'hash' } });
    await old;
    expect(userService.historicalSendActivityPage).toHaveBeenCalledTimes(2);
    expect(component.preview()?.scanned).toBe(1);
    expect(haptics.success).toHaveBeenCalledOnce();
    expect(haptics.error).not.toHaveBeenCalled();
  });

  it('stops repeated cursors without exposing an incomplete preview or enabling Send', async () => {
    component.onSourceChange(component.sourceOptions[3], true);
    userService.historicalSendActivityPage.mockResolvedValue({ scanned: 50, eligibleBySource: { manualUpload: 1 },
      skippedBySource: {}, queued: 0, skippedByReason: {}, failedCount: 0,
      nextCursor: { lastStartDate: 1, lastEventID: 'event-50', queryHash: 'hash' } });
    await component.runPreview();
    expect(userService.historicalSendActivityPage).toHaveBeenCalledTimes(2);
    expect(component.preview()).toBeNull();
    expect(component.canSend).toBe(false);
    expect(component.error()).toBe('Could not preview past activities.');
    expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('keeps the admitted count visible when a later send page fails, and allows retry', async () => {
    component.onSourceChange(component.sourceOptions[3], true);
    userService.historicalSendActivityPage.mockResolvedValueOnce({
      scanned: 1, eligibleBySource: { manualUpload: 1 }, skippedBySource: {}, queued: 0,
      skippedByReason: {}, failedCount: 0, nextCursor: null,
    });
    await component.runPreview();
    userService.historicalSendActivityPage
      .mockResolvedValueOnce({
        scanned: 50, eligibleBySource: { manualUpload: 2 }, skippedBySource: {}, queued: 2,
        skippedByReason: {}, failedCount: 0,
        nextCursor: { lastStartDate: 1, lastEventID: 'event-50', queryHash: 'hash' },
      })
      .mockRejectedValueOnce(new Error('temporary failure'));

    await component.runSend();

    expect(component.sendResult()?.queued).toBe(2);
    expect(component.error()).toContain('after 2 activities');
    expect(component.canSend).toBe(true);
    expect(haptics.error).toHaveBeenCalledOnce();
  });
});
