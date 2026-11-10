import { DestroyRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUserInterface } from '../models/app-user.interface';
import { AppHapticsService } from './app.haptics.service';
import { AppUserService } from './app.user.service';
import { DashboardTodayEditorService } from './dashboard-today-editor.service';
import { LoggerService } from './logger.service';

// Overlay rendering is covered by the editor component suite. This tests the lazy launcher.
vi.mock('../components/summaries/today/dashboard-today-editor.component', () => ({
  DashboardTodayEditorComponent: class {},
}));

describe('Today editor launcher', () => {
  const owner = { uid: 'owner' } as AppUserInterface;
  let origin: DestroyRef;
  const users = { user: signal<AppUserInterface | null>(null) };
  const dialog = { open: vi.fn() };
  const snackBar = { open: vi.fn() };
  const logger = { error: vi.fn() };
  const haptics = { selection: vi.fn(), error: vi.fn(), success: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    users.user.set(owner);
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    TestBed.configureTestingModule({ providers: [
      DashboardTodayEditorService,
      { provide: AppUserService, useValue: users },
      { provide: MatDialog, useValue: dialog },
      { provide: MatSnackBar, useValue: snackBar },
      { provide: AppHapticsService, useValue: haptics },
      { provide: LoggerService, useValue: logger },
    ] });
    origin = TestBed.inject(DestroyRef);
  });

  it('rejects other accounts silently without opening the dialog', async () => {
    users.user.set(null);
    expect(await TestBed.inject(DashboardTodayEditorService).open(owner, origin)).toBe(false);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('reports an opening failure and permits the next explicit attempt', async () => {
    const service = TestBed.inject(DashboardTodayEditorService);
    dialog.open.mockImplementationOnce(() => { throw new Error('Chunk unavailable'); });
    expect(await service.open(owner, origin)).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('Please try again'), 'Dismiss', { duration: 6000 });
    expect(haptics.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(await service.open(owner, origin)).toBe(false);
    expect(dialog.open).toHaveBeenCalledTimes(2);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('opens once while pending and ignores a saved result after the account changes', async () => {
    const closed = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => closed });
    const service = TestBed.inject(DashboardTodayEditorService);
    const pending = service.open(owner, origin);
    expect(await service.open(owner, origin)).toBe(false);
    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledOnce());
    users.user.set({ uid: 'other' } as AppUserInterface);
    closed.next(true);
    expect(await pending).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.error).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('returns a saved result only for the account that opened the editor', async () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    expect(await TestBed.inject(DashboardTodayEditorService).open(owner, origin)).toBe(true);
    expect(dialog.open).toHaveBeenCalledWith(expect.any(Function), {
      data: owner, width: '640px', maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)',
    });
    expect(haptics.selection).toHaveBeenCalledOnce();
    // The editor owns save success feedback.
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('does not open the lazy dialog when the account changes during loading', async () => {
    const pending = TestBed.inject(DashboardTodayEditorService).open(owner, origin);
    users.user.set({ uid: 'other' } as AppUserInterface);
    expect(await pending).toBe(false);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('does not open the lazy dialog after the originating view is destroyed', async () => {
    const pending = TestBed.inject(DashboardTodayEditorService).open(owner, origin);
    TestBed.resetTestingModule();
    expect(await pending).toBe(false);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('closes an open editor silently when its originating view is destroyed', async () => {
    const closed = new Subject<boolean>();
    const close = vi.fn(() => closed.next(false));
    dialog.open.mockReturnValue({ afterClosed: () => closed, close });
    const pending = TestBed.inject(DashboardTodayEditorService).open(owner, origin);
    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledOnce());
    TestBed.resetTestingModule();
    expect(await pending).toBe(false);
    expect(close).toHaveBeenCalledExactlyOnceWith(false);
    expect(haptics.error).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });
});
