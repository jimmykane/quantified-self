import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import equal from 'fast-deep-equal';
import { firstValueFrom, Observable } from 'rxjs';
import { distinctUntilChanged, map, take } from 'rxjs/operators';
import { ActivityInterface } from '@sports-alliance/sports-lib';

import { AppAuthService } from '../../authentication/app.auth.service';
import {
    DEVICE_COLOR_BY_NAME_LIMIT,
    isValidDeviceColor,
    normalizeDeviceColorByName,
    normalizeDeviceColorKey,
    normalizeDeviceColorValue,
    normalizeDeviceDisplaySettings,
} from '../../helpers/device-color-preferences.helper';
import { AppUserInterface } from '../../models/app-user.interface';
import { Firestore, doc, runTransaction } from 'app/firebase/firestore';
import { LoggerService } from '../logger.service';
import { AppColors } from './app.colors';

export const DEVICE_COLOR_PREFERENCE_PALETTE = [
    AppColors.Blue,
    AppColors.StrongOrange,
    AppColors.Green,
    AppColors.Purple,
    AppColors.Red,
    AppColors.LightBlue,
    AppColors.Pink,
    AppColors.LightGreen,
    AppColors.DeepBlue,
    AppColors.Yellow,
].map(color => normalizeDeviceColorValue(color))
    .filter((color): color is string => !!color);

export type DeviceColorPreferenceChangeMap = Record<string, string | null>;

@Injectable({
    providedIn: 'root',
})
export class AppDeviceColorPreferenceService {
    private authService = inject(AppAuthService);
    private firestore = inject(Firestore);
    private logger = inject(LoggerService);
    private user$ = this.authService.user$ as Observable<AppUserInterface | null>;

    readonly deviceDisplaySettings = toSignal(
        this.user$.pipe(
            map(user => normalizeDeviceDisplaySettings(user?.settings?.deviceDisplaySettings)),
            distinctUntilChanged((previous, current) => equal(previous, current)),
        ),
        { initialValue: normalizeDeviceDisplaySettings(null) },
    );

    readonly deviceColorByName = computed(() => this.deviceDisplaySettings().deviceColorByName || {});

    normalizeDeviceColorKey(name: string): string {
        return normalizeDeviceColorKey(name);
    }

    isValidDeviceColor(color: unknown): color is string {
        return isValidDeviceColor(color);
    }

    getPreferredDeviceColor(activity: ActivityInterface | null | undefined): string | null {
        const deviceKey = normalizeDeviceColorKey(activity?.creator?.name);
        return this.getPreferredDeviceColorByKey(deviceKey);
    }

    getPreferredDeviceColorByKey(deviceKey: string | null | undefined): string | null {
        const normalizedKey = normalizeDeviceColorKey(deviceKey);
        if (!normalizedKey) {
            return null;
        }

        return this.deviceColorByName()[normalizedKey] || null;
    }

    async saveDeviceColor(deviceKey: string, color: string): Promise<void> {
        await this.applyDeviceColorChanges({ [deviceKey]: color });
    }

    async resetDeviceColor(deviceKey: string): Promise<void> {
        await this.applyDeviceColorChanges({ [deviceKey]: null });
    }

    async applyDeviceColorChanges(changes: DeviceColorPreferenceChangeMap): Promise<void> {
        const normalizedChanges = this.normalizeChangeMap(changes);
        if (Object.keys(normalizedChanges).length === 0) {
            return;
        }

        const user = await firstValueFrom(this.user$.pipe(take(1)));
        if (!user?.uid) {
            throw new Error('Sign in to save device colors.');
        }

        const settingsRef = doc(this.firestore, 'users', user.uid, 'config', 'settings');

        try {
            await runTransaction(this.firestore, async (transaction) => {
                const settingsSnapshot = await transaction.get(settingsRef);
                const rawSettings = settingsSnapshot.exists()
                    ? settingsSnapshot.data()
                    : {};
                const currentColorByName = normalizeDeviceDisplaySettings(
                    (rawSettings as { deviceDisplaySettings?: unknown }).deviceDisplaySettings,
                ).deviceColorByName || {};
                const nextColorByName = {
                    ...currentColorByName,
                };

                for (const [deviceKey, color] of Object.entries(normalizedChanges)) {
                    if (color === null) {
                        delete nextColorByName[deviceKey];
                    } else {
                        nextColorByName[deviceKey] = color;
                    }
                }

                const cappedNextColorByName = normalizeDeviceColorByName(
                    nextColorByName,
                    DEVICE_COLOR_BY_NAME_LIMIT + 1,
                );
                if (Object.keys(cappedNextColorByName).length > DEVICE_COLOR_BY_NAME_LIMIT) {
                    throw new Error(`You can save colors for up to ${DEVICE_COLOR_BY_NAME_LIMIT} devices.`);
                }

                if (equal(currentColorByName, cappedNextColorByName)) {
                    return;
                }

                transaction.set(
                    settingsRef,
                    {
                        deviceDisplaySettings: {
                            deviceColorByName: cappedNextColorByName,
                        },
                    },
                    { mergeFields: ['deviceDisplaySettings.deviceColorByName'] },
                );
            });
        } catch (error) {
            this.logger.warn('[AppDeviceColorPreferenceService] Failed to save device colors.', error);
            throw error;
        }
    }

    private normalizeChangeMap(changes: DeviceColorPreferenceChangeMap): DeviceColorPreferenceChangeMap {
        const normalizedChanges: DeviceColorPreferenceChangeMap = {};

        for (const [rawDeviceKey, rawColor] of Object.entries(changes)) {
            const deviceKey = normalizeDeviceColorKey(rawDeviceKey);
            if (!deviceKey) {
                continue;
            }

            if (rawColor === null) {
                normalizedChanges[deviceKey] = null;
                continue;
            }

            const color = normalizeDeviceColorValue(rawColor);
            if (!color) {
                throw new Error('Device colors must use #RRGGBB format.');
            }

            normalizedChanges[deviceKey] = color;
        }

        return normalizedChanges;
    }
}
