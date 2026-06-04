import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSelectionListChange } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import equal from 'fast-deep-equal';

import {
  DEVICE_COLOR_BY_NAME_LIMIT,
  normalizeDeviceColorByName,
  normalizeDeviceColorKey,
  normalizeDeviceColorValue,
} from '../../helpers/device-color-preferences.helper';
import {
  AppDeviceColorPreferenceService,
  DEVICE_COLOR_PREFERENCE_PALETTE,
  DeviceColorPreferenceChangeMap,
} from '../../services/color/app-device-color-preference.service';
import { AppColors } from '../../services/color/app.colors';
import { SharedModule } from '../../modules/shared.module';

export interface DeviceColorPreferenceDialogDevice {
  key: string;
  label: string;
  automaticColor?: string | null;
}

export interface DeviceColorPreferencesDialogData {
  devices: DeviceColorPreferenceDialogDevice[];
  initialDeviceKey?: string | null;
}

@Component({
  selector: 'app-device-color-preferences-dialog',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './device-color-preferences-dialog.component.html',
  styleUrls: ['./device-color-preferences-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceColorPreferencesDialogComponent {
  private dialogRef = inject(MatDialogRef<DeviceColorPreferencesDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private deviceColorPreferenceService = inject(AppDeviceColorPreferenceService);
  private data = inject<DeviceColorPreferencesDialogData>(MAT_DIALOG_DATA);
  private originalColorByName = { ...this.deviceColorPreferenceService.deviceColorByName() };

  readonly palette = DEVICE_COLOR_PREFERENCE_PALETTE;
  readonly devices = signal<DeviceColorPreferenceDialogDevice[]>(this.normalizeDevices(this.data.devices));
  readonly selectedDeviceKey = signal(this.resolveInitialDeviceKey());
  readonly stagedColorByName = signal<Record<string, string>>({ ...this.originalColorByName });
  readonly isSaving = signal(false);
  readonly selectedDevice = computed(() =>
    this.devices().find(device => device.key === this.selectedDeviceKey()) || null,
  );
  readonly selectedDeviceColor = computed(() => {
    const deviceKey = this.selectedDeviceKey();
    return deviceKey ? this.stagedColorByName()[deviceKey] || null : null;
  });
  readonly selectedAutomaticColor = computed(() =>
    normalizeDeviceColorValue(this.selectedDevice()?.automaticColor) || AppColors.Blue,
  );
  readonly customColorValue = signal(this.selectedDeviceColor() || this.selectedAutomaticColor());
  readonly hasChanges = computed(() => !equal(this.originalColorByName, this.stagedColorByName()));

  onDeviceSelectionChange(event: MatSelectionListChange): void {
    const selectedOption = event.source.selectedOptions.selected[0] || event.options[0];
    const deviceKey = selectedOption?.value;
    if (typeof deviceKey === 'string') {
      this.selectDevice(deviceKey);
    }
  }

  selectDevice(deviceKey: string): void {
    if (this.isSaving()) {
      return;
    }

    const normalizedDeviceKey = normalizeDeviceColorKey(deviceKey);
    if (!this.devices().some(device => device.key === normalizedDeviceKey)) {
      return;
    }

    this.selectedDeviceKey.set(normalizedDeviceKey);
    this.customColorValue.set(this.selectedDeviceColor() || this.selectedAutomaticColor());
  }

  setSelectedDeviceColor(rawColor: string): void {
    if (this.isSaving()) {
      return;
    }

    const deviceKey = this.selectedDeviceKey();
    const color = normalizeDeviceColorValue(rawColor);
    if (!deviceKey || !color) {
      return;
    }

    this.stagedColorByName.update(colors => ({
      ...colors,
      [deviceKey]: color,
    }));
    this.customColorValue.set(color);
  }

  resetSelectedDeviceColor(): void {
    if (this.isSaving()) {
      return;
    }

    const deviceKey = this.selectedDeviceKey();
    if (!deviceKey) {
      return;
    }

    this.stagedColorByName.update((colors) => {
      const nextColors = { ...colors };
      delete nextColors[deviceKey];
      return nextColors;
    });
    this.customColorValue.set(this.selectedAutomaticColor());
  }

  async apply(): Promise<void> {
    if (this.isSaving()) {
      return;
    }

    if (!this.hasChanges()) {
      this.dialogRef.close(false);
      return;
    }

    this.isSaving.set(true);
    try {
      await this.deviceColorPreferenceService.applyDeviceColorChanges(this.buildChangeMap());
      this.dialogRef.close(true);
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Could not save device colors.';
      this.snackBar.open(message, undefined, { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  private normalizeDevices(devices: DeviceColorPreferenceDialogDevice[]): DeviceColorPreferenceDialogDevice[] {
    const deviceByKey = new Map<string, DeviceColorPreferenceDialogDevice>();

    for (const device of devices || []) {
      const key = normalizeDeviceColorKey(device.key);
      const label = `${device.label || ''}`.trim().replace(/\s+/g, ' ');
      if (!key || !label || deviceByKey.has(key)) {
        continue;
      }

      deviceByKey.set(key, {
        key,
        label,
        automaticColor: normalizeDeviceColorValue(device.automaticColor) || AppColors.Blue,
      });
    }

    return Array.from(deviceByKey.values());
  }

  private resolveInitialDeviceKey(): string {
    const initialDeviceKey = normalizeDeviceColorKey(this.data.initialDeviceKey);
    if (initialDeviceKey && this.devices().some(device => device.key === initialDeviceKey)) {
      return initialDeviceKey;
    }

    return this.devices()[0]?.key || '';
  }

  private buildChangeMap(): DeviceColorPreferenceChangeMap {
    const normalizedStagedColorByName = normalizeDeviceColorByName(
      this.stagedColorByName(),
      DEVICE_COLOR_BY_NAME_LIMIT + 1,
    );
    const keys = new Set([
      ...Object.keys(this.originalColorByName),
      ...Object.keys(normalizedStagedColorByName),
    ]);
    const changes: DeviceColorPreferenceChangeMap = {};

    keys.forEach((key) => {
      const previousColor = this.originalColorByName[key] || null;
      const nextColor = normalizedStagedColorByName[key] || null;
      if (previousColor === nextColor) {
        return;
      }

      changes[key] = nextColor;
    });

    return changes;
  }
}
