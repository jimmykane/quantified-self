import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DeviceColorPreferencesDialogComponent,
  DeviceColorPreferencesDialogData,
} from './device-color-preferences-dialog.component';
import { AppDeviceColorPreferenceService } from '../../services/color/app-device-color-preference.service';

describe('DeviceColorPreferencesDialogComponent', () => {
  let fixture: ComponentFixture<DeviceColorPreferencesDialogComponent>;
  let component: DeviceColorPreferencesDialogComponent;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let deviceColorPreferenceServiceMock: {
    deviceColorByName: ReturnType<typeof vi.fn>;
    applyDeviceColorChanges: ReturnType<typeof vi.fn>;
  };

  function createComponent(data: DeviceColorPreferencesDialogData = {
    devices: [
      {
        key: 'garmin edge',
        label: 'Garmin Edge 3129',
        automaticColor: '#123456',
      },
      {
        key: 'suunto race',
        label: 'Suunto Race',
        automaticColor: '#ABCDEF',
      },
    ],
    initialDeviceKey: 'garmin edge',
  }): void {
    TestBed.configureTestingModule({
      imports: [DeviceColorPreferencesDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: AppDeviceColorPreferenceService, useValue: deviceColorPreferenceServiceMock },
      ],
    });

    fixture = TestBed.createComponent(DeviceColorPreferencesDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    dialogRefMock = {
      close: vi.fn(),
    };
    snackBarMock = {
      open: vi.fn(),
    };
    deviceColorPreferenceServiceMock = {
      deviceColorByName: vi.fn(() => ({
        'garmin edge': '#112233',
      })),
      applyDeviceColorChanges: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('renders device labels with swInfo while keeping saved keys normalized to the base device name', () => {
    createComponent();

    expect(fixture.nativeElement.textContent).toContain('Garmin Edge 3129');
    expect(component.selectedDeviceKey()).toBe('garmin edge');
  });

  it('uses Material controls for device selection and custom color picking', () => {
    createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('mat-selection-list')).toBeTruthy();
    expect(element.querySelectorAll('mat-list-option')).toHaveLength(2);
    expect(element.querySelector('mat-form-field.custom-color-field')).toBeTruthy();
    expect(element.querySelector('input[matinput][type="color"]')).toBeTruthy();
  });

  it('updates the focused device from the Material selection list change event', () => {
    createComponent();

    component.onDeviceSelectionChange({
      source: {
        selectedOptions: {
          selected: [{ value: 'suunto race' }],
        },
      },
      options: [],
    } as any);

    expect(component.selectedDeviceKey()).toBe('suunto race');
    expect(component.customColorValue()).toBe('#ABCDEF');
  });

  it('stages a palette color and persists one settings change on apply', async () => {
    createComponent();

    const paletteButton = (fixture.nativeElement as HTMLElement).querySelector('[aria-label="Use #16B4EA"]') as HTMLButtonElement;
    paletteButton.click();
    fixture.detectChanges();

    await component.apply();

    expect(deviceColorPreferenceServiceMock.applyDeviceColorChanges).toHaveBeenCalledWith({
      'garmin edge': '#16B4EA',
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
  });

  it('stages a custom color and reset without saving until apply', async () => {
    createComponent();

    const colorInput = (fixture.nativeElement as HTMLElement).querySelector('input[type="color"]') as HTMLInputElement;
    colorInput.value = '#445566';
    colorInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.selectedDeviceColor()).toBe('#445566');
    expect(deviceColorPreferenceServiceMock.applyDeviceColorChanges).not.toHaveBeenCalled();

    const resetButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find(button => button.textContent?.includes('Reset to Automatic')) as HTMLButtonElement;
    resetButton.click();
    fixture.detectChanges();

    await component.apply();

    expect(deviceColorPreferenceServiceMock.applyDeviceColorChanges).toHaveBeenCalledWith({
      'garmin edge': null,
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
  });

  it('keeps the editor open and shows a snackbar when save fails', async () => {
    createComponent();
    const snackBarOpenSpy = vi.spyOn((component as any).snackBar, 'open');
    deviceColorPreferenceServiceMock.applyDeviceColorChanges.mockRejectedValueOnce(new Error('write failed'));

    component.setSelectedDeviceColor('#16B4EA');
    await component.apply();

    expect(deviceColorPreferenceServiceMock.applyDeviceColorChanges).toHaveBeenCalledWith({
      'garmin edge': '#16B4EA',
    });
    expect(dialogRefMock.close).not.toHaveBeenCalled();
    expect(snackBarOpenSpy).toHaveBeenCalledWith('write failed', undefined, { duration: 3000 });
  });
});
