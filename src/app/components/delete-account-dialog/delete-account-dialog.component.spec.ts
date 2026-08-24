import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DeleteAccountDialogComponent } from './delete-account-dialog.component';

describe('DeleteAccountDialogComponent', () => {
  let component: DeleteAccountDialogComponent;
  let close: ReturnType<typeof vi.fn>;
  let hapticsService: any;

  beforeEach(() => {
    close = vi.fn();
    hapticsService = {
      selection: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [DeleteAccountDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { displayName: 'Runner' } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: AppHapticsService, useValue: hapticsService },
      ],
    });
    component = TestBed.createComponent(DeleteAccountDialogComponent).componentInstance;
  });

  it('uses a warning haptic for account deletion confirmation', () => {
    component.onConfirm();

    expect(hapticsService.warning).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('keeps the dialog within narrow viewports and lets destructive actions wrap', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/delete-account-dialog/delete-account-dialog.component.scss'),
      'utf8',
    );
    const contentRule = styles.match(/mat-dialog-content\s*\{[^}]*\}/)?.[0] ?? '';
    const actionsRule = styles.match(/mat-dialog-actions\s*\{[^}]*\}/)?.[0] ?? '';

    expect(contentRule).toContain('min-width: min(100%, 380px)');
    expect(actionsRule).toContain('flex-wrap: wrap');
    expect(styles).toContain('@include bp.max-480');
    expect(styles).toContain('flex: 1 1 136px');
  });
});
