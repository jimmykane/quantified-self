import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EventTagsDialogComponent } from './event-tags-dialog.component';

describe('EventTagsDialogComponent', () => {
  let component: EventTagsDialogComponent;
  let fixture: ComponentFixture<EventTagsDialogComponent>;
  let save: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let hapticsService: any;

  beforeEach(() => {
    save = vi.fn().mockResolvedValue(['Race']);
    close = vi.fn();
    hapticsService = {
      selection: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [EventTagsDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { tags: [], suggestions: ['Race'], save },
        },
        { provide: MatDialogRef, useValue: { close, disableClose: false } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: AppHapticsService, useValue: hapticsService },
      ],
    });
    fixture = TestBed.createComponent(EventTagsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('uses success feedback after saving tags', async () => {
    component.selectSuggestion({ option: { value: 'Race' } } as any);

    await component.apply();

    expect(save).toHaveBeenCalledWith(['Race']);
    expect(close).toHaveBeenCalledWith(['Race']);
    expect(hapticsService.success).toHaveBeenCalledOnce();
  });

  it('uses error feedback when saving tags fails', async () => {
    save.mockRejectedValueOnce(new Error('offline'));
    component.selectSuggestion({ option: { value: 'Race' } } as any);

    await component.apply();

    expect(hapticsService.error).toHaveBeenCalledOnce();
  });
});
