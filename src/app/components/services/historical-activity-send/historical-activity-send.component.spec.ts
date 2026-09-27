import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { HistoricalActivitySendComponent } from './historical-activity-send.component';

describe('HistoricalActivitySendComponent', () => {
  const userService = { historicalSendActivityPage: vi.fn() };
  const haptics = { selection: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const snackBar = { open: vi.fn() };
  let component: HistoricalActivitySendComponent;

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      declarations: [HistoricalActivitySendComponent],
      providers: [
        { provide: AppUserService, useValue: userService },
        { provide: AppHapticsService, useValue: haptics },
        { provide: MatSnackBar, useValue: snackBar },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    component = TestBed.createComponent(HistoricalActivitySendComponent).componentInstance;
    component.user = { uid: 'user-1' } as never;
    component.destinationServiceName = ServiceNames.SuuntoApp;
    component.destinationConnected = true;
    component.hasProAccess = true;
    component.ngOnChanges({ destinationServiceName: {} as never, user: {} as never });
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
