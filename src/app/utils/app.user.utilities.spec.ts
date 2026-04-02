import { describe, it, expect } from 'vitest';
import { AppUserUtilities } from './app.user.utilities';
import {
    User,
    ActivityTypes,
    DateRanges,
    AppThemes,
    ChartDataCategoryTypes,
    ChartDataValueTypes,
    ChartTypes,
    DataRecoveryTime,
    TileTypes,
    TimeIntervals
} from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';
import { DASHBOARD_RECOVERY_NOW_CHART_TYPE } from '../helpers/dashboard-special-chart-types';

describe('AppUserUtilities', () => {
    const mockUser = { uid: 'u1', settings: {} } as any;

    it('should default chart fill opacity to zero', () => {
        expect(AppUserUtilities.getDefaultChartFillOpacity()).toBe(0);
    });

    it('should ignore legacy chart fill opacity until the new version marker is set', () => {
        expect(AppUserUtilities.getResolvedChartFillOpacity({ fillOpacity: 0.6 })).toBe(0);
        expect(AppUserUtilities.getResolvedChartFillOpacity({ fillOpacity: 0.6, fillOpacityVersion: 1 })).toBe(0.6);
    });

    describe('isGracePeriodActive', () => {
        it('should return false for null user', () => {
            expect(AppUserUtilities.isGracePeriodActive(null)).toBe(false);
        });

        it('should return true for future date (Timestamp)', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const user = { ...mockUser, gracePeriodUntil: { toMillis: () => futureDate.getTime() } };
            expect(AppUserUtilities.isGracePeriodActive(user)).toBe(true);
        });

        it('should return true for future date (Date)', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const user = { ...mockUser, gracePeriodUntil: futureDate };
            expect(AppUserUtilities.isGracePeriodActive(user)).toBe(true);
        });

        it('should return true for future date (seconds)', () => {
            const futureSeconds = (Date.now() / 1000) + 1000;
            const user = { ...mockUser, gracePeriodUntil: { seconds: futureSeconds } };
            expect(AppUserUtilities.isGracePeriodActive(user)).toBe(true);
        });

        it('should return false for past date', () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 1);
            const user = { ...mockUser, gracePeriodUntil: pastDate };
            expect(AppUserUtilities.isGracePeriodActive(user)).toBe(false);
        });
    });

    describe('hasProAccess', () => {
        it('should return true if isProUser is true', () => {
            const user = { ...mockUser, stripeRole: 'pro' };
            expect(AppUserUtilities.hasProAccess(user)).toBe(true);
        });

        it('should return true if in active grace period', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const user = { ...mockUser, stripeRole: 'free', gracePeriodUntil: futureDate };
            expect(AppUserUtilities.hasProAccess(user)).toBe(true);
        });

        it('should return false for free user with no grace period', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.hasProAccess(user)).toBe(false);
        });
    });

    describe('isProUser', () => {
        it('should return false for null user', () => {
            expect(AppUserUtilities.isProUser(null)).toBe(false);
        });

        it('should return true if stripeRole is pro', () => {
            const user = { ...mockUser, stripeRole: 'pro' };
            expect(AppUserUtilities.isProUser(user)).toBe(true);
        });

        it('should return true if isAdmin is true', () => {
            const user = { ...mockUser, stripeRole: 'basic' };
            expect(AppUserUtilities.isProUser(user, true)).toBe(true);
        });

        it('should return true if user.isPro is true', () => {
            const user = { ...mockUser, isPro: true };
            expect(AppUserUtilities.isProUser(user)).toBe(true);
        });

        it('should return false for basic user without admin/isPro', () => {
            const user = { ...mockUser, stripeRole: 'basic' };
            expect(AppUserUtilities.isProUser(user)).toBe(false);
        });

        it('should return false for free user', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.isProUser(user)).toBe(false);
        });
    });

    describe('isBasicUser', () => {
        it('should return false for null user', () => {
            expect(AppUserUtilities.isBasicUser(null)).toBe(false);
        });

        it('should return true if stripeRole is basic', () => {
            const user = { ...mockUser, stripeRole: 'basic' };
            expect(AppUserUtilities.isBasicUser(user)).toBe(true);
        });

        it('should return false if stripeRole is pro', () => {
            const user = { ...mockUser, stripeRole: 'pro' };
            expect(AppUserUtilities.isBasicUser(user)).toBe(false);
        });

        it('should return false if stripeRole is free', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.isBasicUser(user)).toBe(false);
        });
    });

    describe('hasPaidAccessUser', () => {
        it('should return false for null user', () => {
            expect(AppUserUtilities.hasPaidAccessUser(null)).toBe(false);
        });

        it('should return true for basic user', () => {
            const user = { ...mockUser, stripeRole: 'basic' };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(true);
        });

        it('should return true for pro user', () => {
            const user = { ...mockUser, stripeRole: 'pro' };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(true);
        });

        it('should return true if isAdmin is true', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.hasPaidAccessUser(user, true)).toBe(true);
        });

        it('should return true if user.isPro is true', () => {
            const user = { ...mockUser, isPro: true };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(true);
        });

        it('should return true if user is in grace period', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const user = { ...mockUser, stripeRole: 'free', gracePeriodUntil: futureDate };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(true);
        });

        it('should return false for free user', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(false);
        });
    });

    describe('fillMissingAppSettings', () => {
        it('should not include recovery tile in default dashboard tiles', () => {
            const tiles = AppUserUtilities.getDefaultUserDashboardTiles();
            const recoveryTiles = tiles.filter((tile: any) => (
                tile?.type === TileTypes.Chart && tile?.dataType === DataRecoveryTime.type
            ));

            expect(recoveryTiles).toHaveLength(0);
        });

        it('should fill defaults for empty settings', () => {
            const user = { settings: {} } as User;
            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.appSettings?.theme).toBe(AppThemes.Normal);
            expect(settings.chartSettings?.stackYAxes).toBe(false);
            expect(settings.chartSettings?.syncChartHoverToMap).toBe(false);
            expect(settings.dashboardSettings?.dateRange).toBe(DateRanges.all);
            expect(settings.dashboardSettings?.includeMergedEvents).toBe(true);
            expect(settings.unitSettings?.startOfTheWeek).toBe(1); // Monday
            expect((settings.myTracksSettings as any)?.showJumpHeatmap).toBe(true);
        });

        it('should preserve existing settings', () => {
            const user = {
                settings: {
                    appSettings: { theme: AppThemes.Dark },
                    dashboardSettings: { dateRange: DateRanges.lastYear, includeMergedEvents: false }
                }
            } as User;
            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.appSettings?.theme).toBe(AppThemes.Dark);
            expect(settings.dashboardSettings?.dateRange).toBe(DateRanges.lastYear);
            expect(settings.dashboardSettings?.includeMergedEvents).toBe(false);
        });

        it('should preserve explicit showJumpHeatmap=false', () => {
            const user = {
                settings: {
                    myTracksSettings: {
                        showJumpHeatmap: false
                    }
                }
            } as any;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect((settings.myTracksSettings as any)?.showJumpHeatmap).toBe(false);
        });

        it('should remove legacy mapSettings.showPoints', () => {
            const user = {
                settings: {
                    mapSettings: {
                        showPoints: true
                    }
                }
            } as any;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect((settings.mapSettings as any)?.showPoints).toBeUndefined();
        });

        it('should migrate legacy Spiral dashboard tiles to LinesVertical', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        tiles: [
                            {
                                type: TileTypes.Chart,
                                chartType: ChartTypes.Spiral,
                                dataType: 'distance',
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.DateType,
                                dataTimeInterval: TimeIntervals.Daily,
                                name: 'Legacy Spiral',
                                order: 0,
                                size: { columns: 1, rows: 1 }
                            }
                        ]
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect((settings.dashboardSettings?.tiles?.[0] as any)?.chartType).toBe(ChartTypes.LinesVertical);
        });

        it('should not auto-append a recovery tile for existing users missing one', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        tiles: [
                            {
                                type: TileTypes.Chart,
                                chartType: ChartTypes.ColumnsHorizontal,
                                dataType: 'distance',
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.ActivityType,
                                dataTimeInterval: TimeIntervals.Auto,
                                name: 'Distance',
                                order: 0,
                                size: { columns: 1, rows: 1 }
                            }
                        ]
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            const firstPassRecoveryTiles = settings.dashboardSettings?.tiles?.filter((tile: any) => (
                tile?.type === TileTypes.Chart && tile?.dataType === DataRecoveryTime.type
            )) || [];

            expect(firstPassRecoveryTiles).toHaveLength(0);

            const secondPassSettings = AppUserUtilities.fillMissingAppSettings({ settings } as User);
            const secondPassRecoveryTiles = secondPassSettings.dashboardSettings?.tiles?.filter((tile: any) => (
                tile?.type === TileTypes.Chart && tile?.dataType === DataRecoveryTime.type
            )) || [];
            expect(secondPassRecoveryTiles).toHaveLength(0);
        });

        it('should migrate legacy recovery metric chart tiles to curated recovery chart type', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        tiles: [
                            {
                                type: TileTypes.Chart,
                                chartType: ChartTypes.LinesVertical,
                                dataType: DataRecoveryTime.type,
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.DateType,
                                dataTimeInterval: TimeIntervals.Auto,
                                name: 'Recovery',
                                order: 0,
                                size: { columns: 1, rows: 1 }
                            }
                        ]
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            const recoveryTile = settings.dashboardSettings?.tiles?.find((tile: any) => tile?.dataType === DataRecoveryTime.type) as any;

            expect(recoveryTile).toBeDefined();
            expect(recoveryTile.chartType).toBe(DASHBOARD_RECOVERY_NOW_CHART_TYPE);
            expect(settings.dashboardSettings?.dismissedCuratedRecoveryNowTile).toBe(false);
        });

        it('should still not auto-add curated recovery tile when it has been dismissed', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        dismissedCuratedRecoveryNowTile: true,
                        tiles: [
                            {
                                type: TileTypes.Chart,
                                chartType: ChartTypes.ColumnsHorizontal,
                                dataType: 'distance',
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.ActivityType,
                                dataTimeInterval: TimeIntervals.Auto,
                                name: 'Distance',
                                order: 0,
                                size: { columns: 1, rows: 1 }
                            }
                        ]
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            const recoveryTiles = settings.dashboardSettings?.tiles?.filter((tile: any) => (
                tile?.type === TileTypes.Chart && tile?.dataType === DataRecoveryTime.type
            )) || [];

            expect(recoveryTiles).toHaveLength(0);
            expect(settings.dashboardSettings?.dismissedCuratedRecoveryNowTile).toBe(true);
        });

        it('should normalize malformed legacy chart, unit, and table settings', () => {
            const user = {
                settings: {
                    chartSettings: {
                        dataTypeSettings: {
                            Altitude: { enabled: false },
                            Speed: { enabled: false }
                        }
                    },
                    unitSettings: {
                        speedUnits: [],
                        paceUnits: [],
                        swimPaceUnits: [],
                        verticalSpeedUnits: []
                    },
                    dashboardSettings: {
                        tableSettings: {}
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            const enabledDataTypes = Object.entries(settings.chartSettings.dataTypeSettings)
                .filter(([, value]) => value.enabled === true)
                .map(([key]) => key);

            expect(enabledDataTypes).toEqual(expect.arrayContaining(AppUserUtilities.getDefaultChartDataTypesToShowOnLoad()));
            expect(settings.unitSettings.speedUnits).toEqual(AppUserUtilities.getDefaultSpeedUnits());
            expect(settings.unitSettings.paceUnits).toEqual(AppUserUtilities.getDefaultPaceUnits());
            expect(settings.unitSettings.swimPaceUnits).toEqual(AppUserUtilities.getDefaultSwimPaceUnits());
            expect(settings.unitSettings.verticalSpeedUnits).toEqual(AppUserUtilities.getDefaultVerticalSpeedUnits());
            expect(settings.dashboardSettings.tableSettings.active).toBe('startDate');
            expect(settings.dashboardSettings.tableSettings.direction).toBe('desc');
            expect(settings.dashboardSettings.tableSettings.eventsPerPage).toBe(10);
            expect(settings.dashboardSettings.tableSettings.selectedColumns.length).toBeGreaterThan(0);
        });
    });
});
