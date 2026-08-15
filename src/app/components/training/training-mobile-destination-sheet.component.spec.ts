import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import {
  TrainingMobileDestinationSheetComponent,
  type TrainingMobileDestinationSheetData,
} from './training-mobile-destination-sheet.component';

describe('TrainingMobileDestinationSheetComponent', () => {
  let fixture: ComponentFixture<TrainingMobileDestinationSheetComponent>;
  const bottomSheetRef = { dismiss: vi.fn() };
  const data: TrainingMobileDestinationSheetData = {
    selectedDestination: 'rowing',
    shortcutIds: ['cycling', 'swimming'],
    isAutomatic: true,
    options: [
      { id: 'overview', label: 'All training', iconActivityType: null, materialIcon: 'monitoring' },
      { id: 'running', label: 'Running', iconActivityType: 'Running', materialIcon: null },
      { id: 'cycling', label: 'Cycling', iconActivityType: 'Cycling', materialIcon: null },
      { id: 'swimming', label: 'Swimming', iconActivityType: 'Swimming', materialIcon: null },
      { id: 'rowing', label: 'Rowing', iconActivityType: 'Rowing', materialIcon: null },
    ],
  };

  beforeEach(async () => {
    bottomSheetRef.dismiss.mockReset();
    await TestBed.configureTestingModule({
      imports: [TrainingMobileDestinationSheetComponent, NoopAnimationsModule, MatIconTestingModule],
      providers: [
        { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
        { provide: MatBottomSheetRef, useValue: bottomSheetRef },
        {
          provide: AppEventColorService,
          useValue: {
            getActivityColor: vi.fn(() => ''),
            getColorForActivityTypeByActivityTypeGroup: vi.fn(() => ''),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TrainingMobileDestinationSheetComponent);
    fixture.detectChanges();
  });

  it('puts automatic shortcuts first and sorts the remaining sports', () => {
    const element = fixture.nativeElement as HTMLElement;
    const shortcuts = Array.from(
      element.querySelectorAll<HTMLElement>('.training-mobile-destination-shortcuts [data-destination]'),
    ).map(item => item.querySelector('span')?.textContent?.trim());
    const remaining = Array.from(
      element.querySelectorAll<HTMLElement>('.training-mobile-destination-more [data-destination]'),
    ).map(item => item.querySelector('span')?.textContent?.trim());

    expect(element.textContent).toContain('Switch the analysis you see');
    expect(element.querySelector('[data-destination="overview"]')?.textContent).toContain('All training');
    expect(shortcuts).toEqual(['Cycling', 'Swimming']);
    expect(remaining).toEqual(['Rowing', 'Running']);
    expect(element.querySelector('[data-destination="rowing"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(element.querySelector('[data-destination="rowing"]')?.classList).toContain('mdc-list-item--activated');
    expect(element.querySelector('[data-destination="rowing"] .training-mobile-destination-check')).not.toBeNull();
  });

  it('returns a one-tap destination selection', () => {
    (fixture.nativeElement.querySelector('[data-destination="running"]') as HTMLButtonElement).click();

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({
      kind: 'destination',
      destination: 'running',
    });
  });

  it('returns shortcut management as a separate action', () => {
    const manageButton = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((button: HTMLButtonElement) => button.textContent?.includes('Manage sport shortcuts'));

    manageButton?.click();

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith({ kind: 'manage_shortcuts' });
  });

  it('closes without changing the destination', () => {
    (fixture.nativeElement.querySelector('[aria-label="Close training view picker"]') as HTMLButtonElement).click();

    expect(bottomSheetRef.dismiss).toHaveBeenCalledWith();
  });
});
