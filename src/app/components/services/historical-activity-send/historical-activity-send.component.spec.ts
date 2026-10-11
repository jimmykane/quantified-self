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
      component.onDateChange();
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
    component.onDateChange();
    expect(component.preview).toBeNull();
    expect(component.previewSignature).toBeNull();
    await component.runSend();
    expect(userService.historicalSendActivityPage).toHaveBeenCalledTimes(1);
    await component.runPreview();
    expect(component.canSend).toBe(true);
  });

  it('shows a field error for invalid typed dates without requesting a preview', async () => {
    fixture = TestBed.createComponent(HistoricalActivitySendComponent);
    component = fixture.componentInstance;
    configureComponent();
    component.onSourceChange(component.sourceOptions[3], true);
    fixture.detectChanges();
    await fixture.whenStable();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    haptics.selection.mockClear();
    input.value = 'not a date';
    for (const type of ['input', 'change', 'blur']) input.dispatchEvent(new Event(type, { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.startDate).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-error')?.textContent).toContain('Choose a valid start date');
    expect(component.canPreview).toBe(false);
    await component.runPreview();
    expect(userService.historicalSendActivityPage).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

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
    expect(component.preview?.eligibleBySource.manualUpload).toBe(3);
    expect(component.canSend).toBe(true);
    expect(haptics.success).toHaveBeenCalledOnce();

    component.onSourceChange(component.sourceOptions[0], true);
    expect(component.preview).toBeNull();
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
    expect(component.sendResult?.queued).toBe(1);
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('1 activities scheduled'), undefined, expect.anything());
    expect(haptics.error).not.toHaveBeenCalled();
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

    expect(component.sendResult?.queued).toBe(2);
    expect(component.error).toContain('after 2 activities');
    expect(component.canSend).toBe(true);
    expect(haptics.error).toHaveBeenCalledOnce();
  });
});
