import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { Auth } from 'app/firebase/auth';
import { EventTagsDialogComponent } from './event-tags-dialog.component';

describe('EventTagsDialogComponent', () => {
  let component: EventTagsDialogComponent;
  let fixture: ComponentFixture<EventTagsDialogComponent>;
  let save: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let hapticsService: any;
  let listAllTags: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    save = vi.fn().mockResolvedValue(['Race']);
    close = vi.fn();
    hapticsService = {
      selection: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    };
    listAllTags = vi.fn().mockResolvedValue(['Historical', 'Race']);
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
        { provide: EventTagCatalogService, useValue: { listAllTags } },
        { provide: Auth, useValue: { currentUser: { uid: 'owner-1' } } },
      ],
    });
    fixture = TestBed.createComponent(EventTagsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('uses activity language in the default dialog title', () => {
    expect(component.title).toBe('Activity tags');
  });

  it('adds saved catalog tags to suggestions without haptic feedback', async () => {
    await fixture.whenStable();
    expect(listAllTags).toHaveBeenCalledWith('owner-1');
    expect(component.suggestions()).toEqual(['Historical', 'Race']);
    expect(hapticsService.selection).not.toHaveBeenCalled();
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
