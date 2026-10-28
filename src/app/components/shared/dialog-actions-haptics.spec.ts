import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../services/app.haptics.service';
import { ErrorDialogComponent } from '../login/error-dialog/error-dialog.component';
import { BrowserUpgradeDialogComponent } from '../browser-upgrade-dialog/browser-upgrade-dialog.component';

describe('Legacy dialog haptic actions', () => {
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const close = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      declarations: [ErrorDialogComponent],
      imports: [BrowserUpgradeDialogComponent, MatDialogModule, MatButtonModule, NoopAnimationsModule],
      providers: [
        { provide: AppHapticsService, useValue: haptics },
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { title: 'Unable to sign in', message: 'Please try again.' } },
      ],
    });
  });

  it('gives one selection feedback when acknowledging an error, without vibrating on open', () => {
    const fixture = TestBed.createComponent(ErrorDialogComponent); fixture.detectChanges();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    expect(close).toHaveBeenCalledOnce();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('gives one feedback when dismissing browser guidance', () => {
    const fixture = TestBed.createComponent(BrowserUpgradeDialogComponent); fixture.detectChanges();
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    expect(close).toHaveBeenCalledOnce();
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('gives selection feedback for its explicit Learn more link', () => {
    const fixture = TestBed.createComponent(BrowserUpgradeDialogComponent); fixture.detectChanges();
    fixture.debugElement.query(By.css('a')).triggerEventHandler('click');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
});
