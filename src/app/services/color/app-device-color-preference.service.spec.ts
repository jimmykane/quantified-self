import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserInterface } from '../../models/app-user.interface';
import { Firestore, doc, runTransaction } from 'app/firebase/firestore';
import { LoggerService } from '../logger.service';
import { AppDeviceColorPreferenceService } from './app-device-color-preference.service';

vi.mock('app/firebase/firestore', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        doc: vi.fn((...pathParts: unknown[]) => ({ pathParts })),
        runTransaction: vi.fn(),
    };
});

describe('AppDeviceColorPreferenceService', () => {
    let userSubject: BehaviorSubject<AppUserInterface | null>;
    let service: AppDeviceColorPreferenceService;
    let transactionSetMock: ReturnType<typeof vi.fn>;
    let serverDeviceColorByName: Record<string, unknown>;

    beforeEach(() => {
        vi.clearAllMocks();
        serverDeviceColorByName = {
            ' Garmin   Edge ': '#00ffAA',
            'suunto race': 'blue',
            'polar vantage': '#123',
            'coros pace': '#abcdef',
        };
        transactionSetMock = vi.fn();
        vi.mocked(runTransaction).mockImplementation(async (_firestore, updateFunction: any) => {
            return updateFunction({
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => ({
                        deviceDisplaySettings: {
                            deviceColorByName: serverDeviceColorByName,
                        },
                    }),
                }),
                set: transactionSetMock,
            });
        });
        userSubject = new BehaviorSubject<AppUserInterface | null>({
            uid: 'user-1',
            settings: {
                deviceDisplaySettings: {
                    deviceColorByName: serverDeviceColorByName,
                },
            },
        } as AppUserInterface);

        TestBed.configureTestingModule({
            providers: [
                AppDeviceColorPreferenceService,
                { provide: AppAuthService, useValue: { user$: userSubject.asObservable() } },
                { provide: Firestore, useValue: {} },
                { provide: LoggerService, useValue: { warn: vi.fn() } },
            ],
        });

        service = TestBed.inject(AppDeviceColorPreferenceService);
    });

    it('normalizes device keys and ignores invalid stored colors', () => {
        expect(service.normalizeDeviceColorKey('  Garmin   Edge   Mtb  ')).toBe('garmin edge mtb');
        expect(service.deviceColorByName()).toEqual({
            'garmin edge': '#00FFAA',
            'coros pace': '#ABCDEF',
        });
    });

    it('uses creator name only when resolving preferred colors', () => {
        expect(service.getPreferredDeviceColor({
            creator: {
                name: 'Garmin Edge',
                swInfo: '3129',
            },
        } as any)).toBe('#00FFAA');
        expect(service.getPreferredDeviceColor({
            creator: {
                name: 'Garmin Edge 3129',
            },
        } as any)).toBeNull();
    });

    it('writes one settings merge-field update for saved colors', async () => {
        await service.saveDeviceColor(' Suunto   Race ', '#ff0000');

        expect(doc).toHaveBeenCalledWith({}, 'users', 'user-1', 'config', 'settings');
        expect(transactionSetMock).toHaveBeenCalledWith(
            expect.anything(),
            {
                deviceDisplaySettings: {
                    deviceColorByName: {
                        'garmin edge': '#00FFAA',
                        'coros pace': '#ABCDEF',
                        'suunto race': '#FF0000',
                    },
                },
            },
            { mergeFields: ['deviceDisplaySettings.deviceColorByName'] },
        );
    });

    it('removes reset colors from the stored map', async () => {
        await service.resetDeviceColor('garmin edge');

        expect(transactionSetMock).toHaveBeenCalledWith(
            expect.anything(),
            {
                deviceDisplaySettings: {
                    deviceColorByName: {
                        'coros pace': '#ABCDEF',
                    },
                },
            },
            { mergeFields: ['deviceDisplaySettings.deviceColorByName'] },
        );
    });

    it('rejects invalid saved colors', async () => {
        await expect(service.saveDeviceColor('garmin edge', 'orange')).rejects.toThrow('#RRGGBB');
        expect(runTransaction).not.toHaveBeenCalled();
    });

    it('rejects over-limit saved colors without silently dropping new entries', async () => {
        userSubject.next({
            uid: 'user-1',
            settings: {
                deviceDisplaySettings: {
                    deviceColorByName: {},
                },
            },
        } as AppUserInterface);

        await Promise.resolve();
        await expect(service.applyDeviceColorChanges(Object.fromEntries(
            Array.from({ length: 120 }, (_value, index) => [`device ${index}`, '#123456']),
        ))).rejects.toThrow('up to 100 devices');

        expect(transactionSetMock).not.toHaveBeenCalled();
    });

    it('allows replacing an existing color at the 100 device limit', async () => {
        serverDeviceColorByName = Object.fromEntries(
            Array.from({ length: 100 }, (_value, index) => [`device ${index}`, '#123456']),
        );
        userSubject.next({
            uid: 'user-1',
            settings: {
                deviceDisplaySettings: {
                    deviceColorByName: serverDeviceColorByName,
                },
            },
        } as AppUserInterface);

        await Promise.resolve();
        await service.saveDeviceColor('device 99', '#654321');

        const payload = transactionSetMock.mock.calls[0][1] as {
            deviceDisplaySettings: { deviceColorByName: Record<string, string> };
        };
        expect(Object.keys(payload.deviceDisplaySettings.deviceColorByName)).toHaveLength(100);
        expect(payload.deviceDisplaySettings.deviceColorByName['device 99']).toBe('#654321');
    });

    it('preserves server-side colors that are missing from the current profile signal', async () => {
        serverDeviceColorByName = {
            'garmin edge': '#00FFAA',
            'coros pace': '#ABCDEF',
        };
        userSubject.next({
            uid: 'user-1',
            settings: {
                deviceDisplaySettings: {
                    deviceColorByName: {},
                },
            },
        } as AppUserInterface);

        await Promise.resolve();
        await service.saveDeviceColor('suunto race', '#FF0000');

        expect(transactionSetMock).toHaveBeenCalledWith(
            expect.anything(),
            {
                deviceDisplaySettings: {
                    deviceColorByName: {
                        'garmin edge': '#00FFAA',
                        'coros pace': '#ABCDEF',
                        'suunto race': '#FF0000',
                    },
                },
            },
            { mergeFields: ['deviceDisplaySettings.deviceColorByName'] },
        );
    });

    it('can reset a server-side color even when the current profile signal is missing it', async () => {
        serverDeviceColorByName = {
            'garmin edge': '#00FFAA',
            'coros pace': '#ABCDEF',
        };
        userSubject.next({
            uid: 'user-1',
            settings: {
                deviceDisplaySettings: {
                    deviceColorByName: {},
                },
            },
        } as AppUserInterface);

        await Promise.resolve();
        await service.resetDeviceColor('garmin edge');

        expect(transactionSetMock).toHaveBeenCalledWith(
            expect.anything(),
            {
                deviceDisplaySettings: {
                    deviceColorByName: {
                        'coros pace': '#ABCDEF',
                    },
                },
            },
            { mergeFields: ['deviceDisplaySettings.deviceColorByName'] },
        );
    });
});
