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
import { AppHapticsService } from '../../services/app.haptics.service';

describe('DeviceColorPreferencesDialogComponent', () => {
  let fixture: ComponentFixture<DeviceColorPreferencesDialogComponent>;
  let component: DeviceColorPreferencesDialogComponent;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
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
        { provide: AppHapticsService, useValue: haptics },
      ],
    });

    fixture = TestBed.createComponent(DeviceColorPreferencesDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('uses Material controls for device selection and custom color picking', async () => {
    createComponent();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('mat-selection-list')).toBeTruthy();
    expect(element.querySelectorAll('mat-list-option')).toHaveLength(2);
    expect(element.querySelector('mat-form-field.custom-color-field')).toBeTruthy();
    expect(element.querySelector('input[matinput][type="color"]')).toBeTruthy();
    expect(element.querySelector('mat-select')?.textContent).toContain('Standard');
    expect(component.selectedPaletteID()).toBe('standard');
  });

  it('uses the shared scrollbar for the nested device list', () => {
    createComponent();
    const element = fixture.nativeElement as HTMLElement;
    const dialogContent = element.querySelector('mat-dialog-content');
    const deviceList = element.querySelector('mat-selection-list.device-color-list');

    expect(dialogContent?.classList.contains('qs-scrollbar')).toBe(false);
    expect(deviceList?.classList.contains('qs-scrollbar')).toBe(true);
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
    component.selectPalette('standard');
    fixture.detectChanges();

    const paletteButton = (fixture.nativeElement as HTMLElement).querySelector('[aria-label="Use Blue (#16B4EA)"]') as HTMLButtonElement;
    paletteButton.click();
    fixture.detectChanges();

    await component.apply();

    expect(deviceColorPreferenceServiceMock.applyDeviceColorChanges).toHaveBeenCalledWith({
      'garmin edge': '#16B4EA',
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
  });

  it('stages the published preset, preserves unrelated preferences, and saves once on Apply', async () => {
    deviceColorPreferenceServiceMock.deviceColorByName.mockReturnValue({ 'other device': '#445566' });
    createComponent({ devices: ['One', 'Two', 'Three', 'Four'].map(key => ({ key, label: key })) });
    expect(haptics.selection).not.toHaveBeenCalled();
    const presetButton = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .find(button => button.textContent?.includes('Use Okabe–Ito preset'))!;
    presetButton.click();
    expect(component.stagedColorByName()).toEqual({
      'other device': '#445566', one: '#D55E00', two: '#0072B2', three: '#000000', four: '#CC79A7',
    });
    expect(deviceColorPreferenceServiceMock.applyDeviceColorChanges).not.toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    component.useOkabeItoPreset();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    await component.apply();
    expect(deviceColorPreferenceServiceMock.applyDeviceColorChanges).toHaveBeenCalledExactlyOnceWith({
      one: '#D55E00', two: '#0072B2', three: '#000000', four: '#CC79A7',
    });
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('offers named tan and dark gray swatches and stays silent for no-op selections', () => {
    createComponent();
    component.selectDevice('garmin edge');
    component.setSelectedDeviceColor('#112233');
    expect(haptics.selection).not.toHaveBeenCalled();
    component.selectPalette('okabe-ito');
    component.selectPalette('standard');
    component.selectPalette('standard');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Use Tan (#A68A5B)"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Use Dark gray (#3D3D3D)"]')).toBeTruthy();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('does not repeat the palette or overwrite preferences for more than eight devices', () => {
    createComponent({ devices: Array.from({ length: 9 }, (_, index) => ({ key: `device ${index}`, label: `Device ${index}` })) });
    component.useOkabeItoPreset();
    expect(component.hasChanges()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('locks selections during a pending save and gives success feedback only after completion', async () => {
    createComponent();
    component.useOkabeItoPreset();
    let completeSave!: () => void;
    deviceColorPreferenceServiceMock.applyDeviceColorChanges.mockReturnValue(new Promise<void>(resolve => completeSave = resolve));
    const saving = component.apply();
    haptics.selection.mockClear();
    const staged = component.stagedColorByName();
    component.selectDevice('suunto race');
    component.selectPalette('standard');
    component.setSelectedDeviceColor('#445566');
    component.resetSelectedDeviceColor();
    component.useOkabeItoPreset();
    expect(component.stagedColorByName()).toBe(staged);
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    completeSave();
    await saving;
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('passes over-limit staged additions to the service instead of silently dropping them', async () => {
    const savedColors = Object.fromEntries(
      Array.from({ length: 100 }, (_value, index) => [`device ${index}`, '#112233']),
    );
    deviceColorPreferenceServiceMock.deviceColorByName.mockReturnValue(savedColors);
    createComponent({
      devices: [
        {
          key: 'device 100',
          label: 'Device 100',
          automaticColor: '#123456',
        },
      ],
      initialDeviceKey: 'device 100',
    });

    component.setSelectedDeviceColor('#16B4EA');
    await component.apply();

    expect(deviceColorPreferenceServiceMock.applyDeviceColorChanges).toHaveBeenCalledWith({
      'device 100': '#16B4EA',
    });
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
    expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
  });
});
