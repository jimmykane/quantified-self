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
    DataDistance,
    DataHeartRateAvg,
    DistanceUnits,
    TileTypes,
    TimeIntervals
} from '@sports-alliance/sports-lib';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from '../helpers/dashboard-form.helper';
import {
    DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
    DASHBOARD_FORM_CHART_TYPE,
    DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
    DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
    DASHBOARD_RECOVERY_NOW_CHART_TYPE,
    DASHBOARD_SLEEP_TREND_CHART_TYPE,
    getDefaultDashboardKpiChartDefinitions,
    getDashboardCuratedChartDefinitions,
    isDashboardCuratedChartType,
    isDashboardKpiChartType,
    isDashboardSpecialChartType,
} from '../helpers/dashboard-special-chart-types';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';

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
        it('should include all non-sleep curated tiles in default dashboard tiles', () => {
            const tiles = AppUserUtilities.getDefaultUserDashboardTiles() as any[];
            const curatedDefinitions = getDashboardCuratedChartDefinitions()
                .filter(definition => definition.chartType !== DASHBOARD_SLEEP_TREND_CHART_TYPE);
            const curatedTiles = tiles.filter((tile: any) => (
                tile?.type === TileTypes.Chart && isDashboardCuratedChartType(tile?.chartType)
            ));

            expect(curatedTiles.map(tile => tile.chartType)).toEqual(curatedDefinitions.map(definition => definition.chartType));
            expect(curatedTiles.map(tile => tile.name)).toEqual([
                'Recovery',
                'Form',
                'Freshness Forecast',
                'Intensity Distribution',
                'Efficiency Trend',
            ]);
            curatedTiles.forEach((tile, index) => {
                expect(tile).toMatchObject({
                    order: 4 + index,
                    size: { columns: 1, rows: 1 },
                    dataCategoryType: ChartDataCategoryTypes.DateType,
                    dataValueType: ChartDataValueTypes.Total,
                });
                expect(tile.eventFilters).toBeUndefined();
            });
            expect(curatedTiles.find(tile => tile.chartType === DASHBOARD_RECOVERY_NOW_CHART_TYPE)).toMatchObject({
                dataType: DataRecoveryTime.type,
                dataTimeInterval: TimeIntervals.Auto,
            });
            expect(curatedTiles.find(tile => tile.chartType === DASHBOARD_FORM_CHART_TYPE)).toMatchObject({
                dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
                dataTimeInterval: TimeIntervals.Daily,
                displaySettings: { formTimelineWindow: 'w' },
            });
            [
                DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
            ].forEach((chartType) => {
                expect(curatedTiles.find(tile => tile.chartType === chartType)).toMatchObject({
                    dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
                    dataTimeInterval: TimeIntervals.Weekly,
                });
            });
            [
                DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
                DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
            ].forEach((chartType) => {
                expect(curatedTiles.find(tile => tile.chartType === chartType)).toMatchObject({
                    dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
                    dataTimeInterval: TimeIntervals.Weekly,
                    displaySettings: { derivedChartRange: '1y' },
                });
            });
        });

        it('should not include sleep tile in default dashboard tiles', () => {
            const tiles = AppUserUtilities.getDefaultUserDashboardTiles();
            const sleepTiles = tiles.filter((tile: any) => (
                tile?.type === TileTypes.Chart
                && (tile?.chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE || tile?.dataType === 'SleepDuration')
            ));

            expect(sleepTiles).toHaveLength(0);
        });

        it('should include recommended KPI tiles in default dashboard tiles', () => {
            const tiles = AppUserUtilities.getDefaultUserDashboardTiles() as any[];
            const kpiDefinitions = getDefaultDashboardKpiChartDefinitions();
            const kpiTiles = tiles.filter(tile => (
                tile?.type === TileTypes.Chart && isDashboardKpiChartType(tile?.chartType)
            ));

            expect(kpiTiles.map(tile => tile.chartType)).toEqual(kpiDefinitions.map(definition => definition.chartType));
            kpiTiles.forEach((tile, index) => {
                expect(tile).toMatchObject({
                    name: kpiDefinitions[index].label,
                    order: 9 + index,
                    size: { columns: 1, rows: 1 },
                    dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
                    dataCategoryType: ChartDataCategoryTypes.DateType,
                    dataValueType: ChartDataValueTypes.Total,
                    dataTimeInterval: TimeIntervals.Weekly,
                });
                expect(tile.eventFilters).toBeUndefined();
            });
        });

        it('should fill defaults for empty settings', () => {
            const user = { settings: {} } as User;
            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.appSettings?.theme).toBe(AppThemes.Normal);
            expect((settings.appSettings as any)?.unitSetupCompleted).toBeUndefined();
            expect((settings.appSettings as any)?.dashboardActionPrompts).toEqual({});
            expect(settings.chartSettings?.stackYAxes).toBe(false);
            expect(settings.chartSettings?.showSwimLengths).toBe(true);
            expect(settings.chartSettings?.syncChartHoverToMap).toBe(false);
            expect(settings.chartSettings?.eventChartOverlayDataTypeByPrimary).toEqual({});
            expect(settings.dashboardSettings?.dateRange).toBe(DateRanges.all);
            expect(settings.dashboardSettings?.includeMergedEvents).toBe(true);
            expect(settings.dashboardSettings?.eventTableFilters).toEqual({
                searchTerm: null,
                dateRange: DateRanges.thisWeek,
                startDate: null,
                endDate: null,
                activityTypes: [],
                includeMergedEvents: true
            });
            expect(settings.dashboardSettings?.sleepTrend?.range).toBe('14d');
            expect(settings.dashboardSettings?.autoTiles).toEqual({});
            expect(settings.dashboardSettings?.tiles?.some((tile: any) => (
                tile?.type === TileTypes.Chart
                && (tile?.chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE || tile?.dataType === 'SleepDuration')
            ))).toBe(false);
            expect(settings.unitSettings?.distanceUnits).toBe(DistanceUnits.Kilometers);
            expect(settings.unitSettings?.startOfTheWeek).toBe(1); // Monday
            expect((settings.myTracksSettings as any)?.startDate).toBeNull();
            expect((settings.myTracksSettings as any)?.endDate).toBeNull();
            expect((settings.myTracksSettings as any)?.showJumpHeatmap).toBe(true);
            expect(settings.serviceSyncSettings?.activitySyncRoutes?.[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]?.enabled).toBe(false);
            expect(settings.serviceSyncSettings?.activitySyncRoutes?.[ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]?.enabled).toBe(false);
        });

        it('should preserve valid dashboard action prompt dismissal state', () => {
            const user = {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            connectActivityService: {
                                state: 'dismissed',
                                dismissedAt: 1_777_200_000_000,
                                source: 'activity-service-connection',
                            },
                            enableActivityAutoSync: {
                                state: 'dismissed',
                                dismissedAt: 1_777_210_000_000,
                                source: 'activity-auto-sync',
                            },
                        },
                    },
                },
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);

            expect((settings.appSettings as any)?.dashboardActionPrompts).toEqual({
                connectActivityService: {
                    state: 'dismissed',
                    dismissedAt: 1_777_200_000_000,
                    source: 'activity-service-connection',
                },
                enableActivityAutoSync: {
                    state: 'dismissed',
                    dismissedAt: 1_777_210_000_000,
                    source: 'activity-auto-sync',
                },
            });
        });

        it('should drop invalid dashboard action prompt states and preserve valid future states', () => {
            const user = {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            connectActivityService: {
                                state: 'added',
                                dismissedAt: 'bad',
                            },
                            futurePrompt: {
                                state: 'dismissed',
                                dismissedAt: 1_777_300_000_000,
                                source: 'future-source',
                            },
                        },
                    },
                },
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);

            expect((settings.appSettings as any)?.dashboardActionPrompts).toEqual({
                futurePrompt: {
                    state: 'dismissed',
                    dismissedAt: 1_777_300_000_000,
                    source: 'future-source',
                },
            });
        });

        it('should preserve valid dashboard auto-tile state', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        autoTiles: {
                            sleepTrend: {
                                state: 'dismissed',
                                dismissedAt: 1_777_000_000_000,
                                lastQualifiedAt: 1_776_000_000_000,
                                source: 'sleep-sync',
                            },
                        },
                    },
                },
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);

            expect(settings.dashboardSettings?.autoTiles).toEqual({
                sleepTrend: {
                    state: 'dismissed',
                    dismissedAt: 1_777_000_000_000,
                    lastQualifiedAt: 1_776_000_000_000,
                    source: 'sleep-sync',
                },
            });
        });

        it('should drop invalid dashboard auto-tile state and preserve valid future states without touching tiles', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        autoTiles: {
                            sleepTrend: {
                                state: 'invalid',
                                addedAt: 'bad',
                            },
                            unknown: {
                                state: 'dismissed',
                                dismissedAt: 1_777_100_000_000,
                                source: 'future-rule',
                            },
                        },
                        tiles: [{
                            type: TileTypes.Chart,
                            chartType: ChartTypes.ColumnsHorizontal,
                            dataType: DataDistance.type,
                            dataValueType: ChartDataValueTypes.Total,
                            dataCategoryType: ChartDataCategoryTypes.ActivityType,
                            dataTimeInterval: TimeIntervals.Auto,
                            name: 'Distance',
                            order: 0,
                            size: { columns: 1, rows: 1 }
                        }],
                    },
                },
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);

            expect(settings.dashboardSettings?.autoTiles).toEqual({
                unknown: {
                    state: 'dismissed',
                    dismissedAt: 1_777_100_000_000,
                    source: 'future-rule',
                },
            });
            expect(settings.dashboardSettings?.tiles).toHaveLength(1);
            expect(settings.dashboardSettings?.tiles?.[0].name).toBe('Distance');
        });

        it('should normalize event table filters from legacy dashboard fields', () => {
            const startDate = new Date('2026-01-01T00:00:00.000Z').getTime();
            const endDate = new Date('2026-01-31T23:59:59.999Z').getTime();
            const user = {
                settings: {
                    dashboardSettings: {
                        dateRange: DateRanges.custom,
                        startDate,
                        endDate,
                        activityTypes: [ActivityTypes.Running],
                        includeMergedEvents: false
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);

            expect(settings.dashboardSettings?.eventTableFilters).toEqual({
                searchTerm: null,
                dateRange: DateRanges.custom,
                startDate,
                endDate,
                activityTypes: [ActivityTypes.Running],
                includeMergedEvents: false
            });
            expect(settings.dashboardSettings?.dateRange).toBe(DateRanges.custom);
            expect(settings.dashboardSettings?.activityTypes).toEqual([ActivityTypes.Running]);
        });

        it('should default new custom chart and map tiles to 90d and all activities', () => {
            const defaultChart = AppUserUtilities.getDefaultUserDashboardChartTile() as any;
            const defaultMap = AppUserUtilities.getDefaultUserDashboardMapTile() as any;
            const dashboardTiles = AppUserUtilities.getDefaultUserDashboardTiles() as any[];

            expect(defaultChart.eventFilters).toEqual({ range: '90d', activityTypes: [] });
            expect(defaultMap.eventFilters).toEqual({ range: '90d', activityTypes: [] });
            dashboardTiles
                .filter(tile => tile.type === TileTypes.Map || !isDashboardSpecialChartType(tile.chartType))
                .forEach(tile => {
                    expect(tile.eventFilters).toEqual({ range: '90d', activityTypes: [] });
                });
        });

        it('should add event filters to existing custom chart and map tiles from legacy dashboard filters', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        dateRange: DateRanges.all,
                        activityTypes: [ActivityTypes.Cycling],
                        tiles: [
                            {
                                type: TileTypes.Chart,
                                chartType: ChartTypes.ColumnsHorizontal,
                                dataType: DataDistance.type,
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.ActivityType,
                                dataTimeInterval: TimeIntervals.Auto,
                                name: 'Distance',
                                order: 0,
                                size: { columns: 1, rows: 1 }
                            },
                            {
                                type: TileTypes.Map,
                                order: 1,
                                name: 'Map',
                                mapStyle: 'default',
                                mapTheme: 'normal',
                                showHeatMap: true,
                                clusterMarkers: true,
                                size: { columns: 1, rows: 1 }
                            }
                        ]
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            const [customTile, mapTile] = settings.dashboardSettings?.tiles || [];

            expect((customTile as any).eventFilters).toEqual({
                range: '1y',
                activityTypes: [ActivityTypes.Cycling]
            });
            expect((mapTile as any).eventFilters).toEqual({
                range: '1y',
                activityTypes: [ActivityTypes.Cycling]
            });
        });

        it('should remove event filters from curated and derived chart tiles', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        tiles: [
                            {
                                type: TileTypes.Chart,
                                chartType: DASHBOARD_FORM_CHART_TYPE,
                                dataType: 'Training Stress Score',
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.DateType,
                                dataTimeInterval: TimeIntervals.Daily,
                                name: 'Form',
                                order: 0,
                                size: { columns: 1, rows: 1 },
                                eventFilters: { range: 'all', activityTypes: [ActivityTypes.Running] }
                            }
                        ]
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);

            expect((settings.dashboardSettings?.tiles?.[0] as any).eventFilters).toBeUndefined();
        });

        it('should normalize display ranges for supported curated chart tiles', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        tiles: [
                            {
                                type: TileTypes.Chart,
                                chartType: DASHBOARD_FORM_CHART_TYPE,
                                dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.DateType,
                                dataTimeInterval: TimeIntervals.Daily,
                                name: 'Form',
                                order: 0,
                                size: { columns: 1, rows: 1 },
                                displaySettings: { formTimelineWindow: 'y', derivedChartRange: 'all' }
                            },
                            {
                                type: TileTypes.Chart,
                                chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
                                dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.DateType,
                                dataTimeInterval: TimeIntervals.Weekly,
                                name: 'Intensity Distribution',
                                order: 1,
                                size: { columns: 1, rows: 1 },
                                displaySettings: { derivedChartRange: 'bad-range', formTimelineWindow: 'm' }
                            },
                            {
                                type: TileTypes.Chart,
                                chartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
                                dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.DateType,
                                dataTimeInterval: TimeIntervals.Weekly,
                                name: 'Efficiency Trend',
                                order: 2,
                                size: { columns: 1, rows: 1 }
                            },
                            {
                                type: TileTypes.Chart,
                                chartType: ChartTypes.ColumnsHorizontal,
                                dataType: DataDistance.type,
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.ActivityType,
                                dataTimeInterval: TimeIntervals.Auto,
                                name: 'Distance',
                                order: 3,
                                size: { columns: 1, rows: 1 },
                                displaySettings: { derivedChartRange: '8w' }
                            }
                        ]
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            const [formTile, intensityTile, efficiencyTile, customTile] = settings.dashboardSettings?.tiles || [];

            expect((formTile as any).displaySettings).toEqual({ formTimelineWindow: 'y' });
            expect((intensityTile as any).displaySettings).toEqual({ derivedChartRange: '1y' });
            expect((efficiencyTile as any).displaySettings).toEqual({ derivedChartRange: '1y' });
            expect((customTile as any).displaySettings).toBeUndefined();
        });

        it('should preserve existing settings', () => {
            const user = {
                settings: {
                    appSettings: { theme: AppThemes.Dark, unitSetupCompleted: false } as any,
                    dashboardSettings: { dateRange: DateRanges.lastYear, includeMergedEvents: false, sleepTrend: { range: '90d' } }
                }
            } as User;
            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.appSettings?.theme).toBe(AppThemes.Dark);
            expect((settings.appSettings as any)?.unitSetupCompleted).toBe(false);
            expect(settings.dashboardSettings?.dateRange).toBe(DateRanges.lastYear);
            expect(settings.dashboardSettings?.includeMergedEvents).toBe(false);
            expect(settings.dashboardSettings?.sleepTrend?.range).toBe('90d');
        });

        it('should normalize invalid sleep trend range settings to 14d', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        sleepTrend: {
                            range: '7d',
                        },
                    },
                },
            } as any;

            const settings = AppUserUtilities.fillMissingAppSettings(user);

            expect(settings.dashboardSettings?.sleepTrend?.range).toBe('14d');
        });

        it('should preserve explicit service sync route toggle', () => {
            const user = {
                settings: {
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true }
                        }
                    }
                }
            } as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.serviceSyncSettings?.activitySyncRoutes?.[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]?.enabled).toBe(true);
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

        it('should preserve valid custom MyTracks date boundaries', () => {
            const startDate = Date.parse('2025-02-01T00:00:00.000Z');
            const endDate = Date.parse('2025-02-10T23:59:59.999Z');
            const user = {
                settings: {
                    myTracksSettings: {
                        dateRange: DateRanges.custom,
                        startDate,
                        endDate
                    }
                }
            } as any;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.myTracksSettings?.dateRange).toBe(DateRanges.custom);
            expect((settings.myTracksSettings as any)?.startDate).toBe(startDate);
            expect((settings.myTracksSettings as any)?.endDate).toBe(endDate);
        });

        it('should fall back from custom MyTracks range when a boundary is missing', () => {
            const user = {
                settings: {
                    myTracksSettings: {
                        dateRange: DateRanges.custom,
                        startDate: Date.parse('2025-02-01T00:00:00.000Z')
                    }
                }
            } as any;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.myTracksSettings?.dateRange).toBe(AppUserUtilities.getDefaultMyTracksDateRange());
            expect((settings.myTracksSettings as any)?.endDate).toBeNull();
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

        it('should keep only one map tile and preserve the first map by order', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        tiles: [
                            {
                                type: TileTypes.Map,
                                order: 2,
                                name: 'Map-later',
                                mapStyle: 'satellite',
                                mapTheme: 'normal',
                                showHeatMap: true,
                                clusterMarkers: false,
                                size: { columns: 1, rows: 1 }
                            },
                            {
                                type: TileTypes.Chart,
                                order: 1,
                                chartType: ChartTypes.ColumnsHorizontal,
                                dataType: 'distance',
                                dataValueType: ChartDataValueTypes.Total,
                                dataCategoryType: ChartDataCategoryTypes.ActivityType,
                                dataTimeInterval: TimeIntervals.Auto,
                                name: 'Distance',
                                size: { columns: 1, rows: 1 }
                            },
                            {
                                type: TileTypes.Map,
                                order: 0,
                                name: 'Map-first',
                                mapStyle: 'outdoors',
                                mapTheme: 'normal',
                                showHeatMap: true,
                                clusterMarkers: true,
                                size: { columns: 1, rows: 1 }
                            }
                        ]
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            const mapTiles = settings.dashboardSettings?.tiles?.filter((tile: any) => tile?.type === TileTypes.Map) || [];
            const chartTiles = settings.dashboardSettings?.tiles?.filter((tile: any) => tile?.type === TileTypes.Chart) || [];

            expect(mapTiles).toHaveLength(1);
            expect(mapTiles[0].name).toBe('Map-first');
            expect(mapTiles[0].mapStyle).toBe('outdoors');
            expect(chartTiles).toHaveLength(1);
            expect(chartTiles[0].name).toBe('Distance');
        });

        it('should normalize malformed legacy chart, unit, and table settings', () => {
            const user = {
                settings: {
                    chartSettings: {
                        dataTypeSettings: {
                            Altitude: { enabled: false },
                            Speed: { enabled: false }
                        },
                        eventChartOverlayDataTypeByPrimary: {
                            Power: ' Power ',
                            ' Heart Rate ': ' Altitude ',
                            Cadence: 42
                        }
                    },
                    unitSettings: {
                        speedUnits: [],
                        paceUnits: [],
                        swimPaceUnits: [],
                        verticalSpeedUnits: [],
                        distanceUnits: 'bad-value'
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
            expect(settings.unitSettings.distanceUnits).toBe(DistanceUnits.Kilometers);
            expect(settings.chartSettings.eventChartOverlayDataTypeByPrimary).toEqual({
                'Heart Rate': 'Altitude'
            });
            expect(settings.dashboardSettings.tableSettings.active).toBe('Start Date');
            expect(settings.dashboardSettings.tableSettings.direction).toBe('desc');
            expect(settings.dashboardSettings.tableSettings.eventsPerPage).toBe(10);
            expect(settings.dashboardSettings.tableSettings.selectedColumns.length).toBeGreaterThan(0);
        });

        it('should normalize legacy distance unit strings', () => {
            const metricSettings = AppUserUtilities.fillMissingAppSettings({
                settings: {
                    unitSettings: {
                        distanceUnits: 'Metric'
                    }
                }
            } as unknown as User);
            const imperialSettings = AppUserUtilities.fillMissingAppSettings({
                settings: {
                    unitSettings: {
                        distanceUnits: 'Imperial'
                    }
                }
            } as unknown as User);

            expect(metricSettings.unitSettings.distanceUnits).toBe(DistanceUnits.Kilometers);
            expect(imperialSettings.unitSettings.distanceUnits).toBe(DistanceUnits.Miles);
        });

        it('should normalize legacy table column aliases for sorting and selected columns', () => {
            const user = {
                settings: {
                    dashboardSettings: {
                        tableSettings: {
                            active: 'Average Heartrate',
                            selectedColumns: ['Average Heartrate', 'Distance', 'Average Heart Rate']
                        }
                    }
                }
            } as unknown as User;

            const settings = AppUserUtilities.fillMissingAppSettings(user);

            expect(settings.dashboardSettings.tableSettings.active).toBe(DataHeartRateAvg.type);
            expect(settings.dashboardSettings.tableSettings.selectedColumns).toEqual([DataHeartRateAvg.type, 'Distance']);
        });
    });
});
