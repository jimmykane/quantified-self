import {
    ActivityTypes,
    AppThemes,
    ChartCursorBehaviours,
    ChartDataCategoryTypes,
    ChartDataValueTypes,
    ChartTypes,
    DataTypeSettings,
    DateRanges,
    DaysOfTheWeek,
    DistanceUnits,
    GradeAdjustedPaceUnits,
    GradeAdjustedSpeedUnits,
    LapTypes,
    PaceUnits,
    PaceUnitsToGradeAdjustedPaceUnits,
    SpeedUnits,
    SpeedUnitsToGradeAdjustedSpeedUnits,
    SwimPaceUnits,
    TableSettings,
    TileChartSettingsInterface,
    TileMapSettingsInterface,
    TileSettingsInterface,
    TileTypes,
    TimeIntervals,
    UserAppSettingsInterface,
    UserChartSettingsInterface,
    UserMyTracksSettingsInterface,
    UserUnitSettingsInterface,
    UserSummariesSettingsInterface,
    UserExportToCsvSettingsInterface,
    VerticalSpeedUnits,
    XAxisTypes,
    MapThemes,
    MapTypes,
    DataDescription,
    DataActivityTypes,
    DataDuration,
    DataDistance,
    DataAscent,
    DataDescent,
    DataEnergy,
    DataHeartRateAvg,
    DataSpeedAvg,
    DataPowerAvg,
    DataVO2Max,
    DataAerobicTrainingEffect,
    DataRecoveryTime,
    DataPeakEPOC,
    DataDeviceNames,
    DataAltitude,
    DataHeartRate,
    User,
} from '@sports-alliance/sports-lib';
import { isNumber } from 'lodash-es';
import {
    AppChartSettingsInterface,
    AppDashboardChartTileSettingsInterface,
    AppDashboardMapTileSettingsInterface,
    AppDashboardAutoTiles,
    AppDashboardAutoTileState,
    AppMapStyleName,
    AppDashboardSettingsInterface,
    AppDashboardTileEventFiltersInterface,
    AppMapSettingsInterface,
    AppMyTracksSettings,
    AppUserInterface,
    AppUserSettingsInterface
} from '../models/app-user.interface';
import {
    DASHBOARD_RECOVERY_NOW_CHART_TYPE,
    DASHBOARD_SLEEP_TREND_CHART_TYPE,
    getDefaultDashboardKpiChartDefinitions,
    getDashboardCuratedChartDefinitions,
    isDashboardEventBackedSpecialChartType,
    isDashboardRecoveryNowChartType,
    isDashboardSpecialChartType,
} from '../helpers/dashboard-special-chart-types';
import { normalizeDashboardSleepTrendRange } from '../helpers/dashboard-sleep-range.helper';
import {
    DASHBOARD_EVENT_TABLE_DEFAULT_DATE_RANGE,
    DASHBOARD_TILE_EVENT_DEFAULT_RANGE,
    normalizeDashboardEventTableFilters,
    normalizeDashboardTileEventFilters,
    resolveLegacyDashboardTileEventFilterRange,
} from '../helpers/dashboard-tile-event-filters.helper';
import {
    buildDashboardCuratedAutoTile,
    buildDashboardKpiAutoTile,
    type DashboardDefaultCuratedChartType,
} from '../helpers/dashboard-auto-tile.helper';
import { normalizeDashboardActionPrompts } from '../helpers/dashboard-action-prompt.helper';
import { normalizeEventChartOverlayDataTypeByPrimary } from '../helpers/event-chart-overlay.helper';
import {
    normalizeDashboardChartTileDisplaySettingsForChartType,
} from '../helpers/dashboard-chart-display-settings.helper';
import { getAppBasicChartDataTypes, getAppCanonicalChartDataTypes } from '../helpers/app-chart-data-types.helper';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '@shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTES, RouteDeliverySyncRouteId } from '@shared/route-delivery-sync-routes';
import { normalizeDistanceUnits } from '@shared/unit-aware-display';
import { normalizeDeviceDisplaySettings } from '../helpers/device-color-preferences.helper';

/**
 * Utility class for AppUser related static methods and default settings.
 * This class handles non-reactive logic such as subscription status checks
 * and providing default application/user settings.
 */
export class AppUserUtilities {

    /**
     * Returns the default application theme.
     */
    static getDefaultAppTheme(): AppThemes {
        return AppThemes.Normal;
    }

    static getDefaultChartCursorBehaviour(): ChartCursorBehaviours {
        return ChartCursorBehaviours.ZoomX;
    }

    static getDefaultMapStrokeWidth(): number {
        return 4;
    }

    static getDefaultChartDataTypesToShowOnLoad(): string[] {
        return [
            DataAltitude.type,
            DataHeartRate.type,
        ]
    }

    static getDefaultUserChartSettingsDataTypeSettings(): DataTypeSettings {
        return getAppBasicChartDataTypes().reduce((dataTypeSettings: DataTypeSettings, dataTypeToUse: string) => {
            dataTypeSettings[dataTypeToUse] = { enabled: true };
            return dataTypeSettings
        }, {})
    }

    static getDefaultUserDashboardChartTile(): TileChartSettingsInterface {
        return <AppDashboardChartTileSettingsInterface>{
            name: 'Distance',
            order: 0,
            type: TileTypes.Chart,
            chartType: ChartTypes.ColumnsHorizontal,
            dataType: DataDistance.type,
            dataTimeInterval: TimeIntervals.Auto,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            dataValueType: ChartDataValueTypes.Total,
            size: { columns: 1, rows: 1 },
            eventFilters: AppUserUtilities.getDefaultDashboardTileEventFilters(),
        };
    }

    static getDefaultUserDashboardMapTile(): TileMapSettingsInterface {
        return <AppDashboardMapTileSettingsInterface><unknown>{
            name: 'Clustered HeatMap',
            order: 0,
            type: TileTypes.Map,
            mapStyle: this.getDefaultDashboardMapStyle(),
            mapTheme: MapThemes.Normal,
            showHeatMap: true,
            clusterMarkers: true,
            size: { columns: 1, rows: 1 },
            eventFilters: AppUserUtilities.getDefaultDashboardTileEventFilters(),
        };
    }

    static getDefaultDashboardTileEventFilters(): AppDashboardTileEventFiltersInterface {
        return {
            range: DASHBOARD_TILE_EVENT_DEFAULT_RANGE,
            activityTypes: [],
        };
    }

    static getDefaultUserDashboardTiles(): TileSettingsInterface[] {
        const defaultMainTiles: TileSettingsInterface[] = [<AppDashboardMapTileSettingsInterface><unknown>{
            name: 'Clustered HeatMap',
            order: 0,
            type: TileTypes.Map,
            mapStyle: this.getDefaultDashboardMapStyle(),
            mapTheme: MapThemes.Normal,
            showHeatMap: true,
            clusterMarkers: true,
            size: { columns: 1, rows: 1 },
            eventFilters: AppUserUtilities.getDefaultDashboardTileEventFilters(),
        }, <AppDashboardChartTileSettingsInterface>{
            name: 'Duration',
            order: 1,
            type: TileTypes.Chart,
            chartType: ChartTypes.Pie,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            dataType: DataDuration.type,
            dataTimeInterval: TimeIntervals.Auto,
            dataValueType: ChartDataValueTypes.Total,
            size: { columns: 1, rows: 1 },
            eventFilters: AppUserUtilities.getDefaultDashboardTileEventFilters(),
        }, <AppDashboardChartTileSettingsInterface>{
            name: 'Distance',
            order: 2,
            type: TileTypes.Chart,
            chartType: ChartTypes.ColumnsHorizontal,
            dataType: DataDistance.type,
            dataTimeInterval: TimeIntervals.Auto,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            dataValueType: ChartDataValueTypes.Total,
            size: { columns: 1, rows: 1 },
            eventFilters: AppUserUtilities.getDefaultDashboardTileEventFilters(),
        }, <AppDashboardChartTileSettingsInterface>{
            name: 'Ascent',
            order: 3,
            type: TileTypes.Chart,
            chartType: ChartTypes.PyramidsVertical,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            dataType: DataAscent.type,
            dataTimeInterval: TimeIntervals.Auto,
            dataValueType: ChartDataValueTypes.Total,
            size: { columns: 1, rows: 1 },
            eventFilters: AppUserUtilities.getDefaultDashboardTileEventFilters(),
        }];
        const defaultCuratedTiles = AppUserUtilities.getDefaultUserDashboardCuratedTiles(defaultMainTiles.length);
        return [
            ...defaultMainTiles,
            ...defaultCuratedTiles,
            ...AppUserUtilities.getDefaultUserDashboardKpiTiles(defaultMainTiles.length + defaultCuratedTiles.length),
        ];
    }

    private static getDefaultUserDashboardCuratedTiles(startOrder: number): TileChartSettingsInterface[] {
        return getDashboardCuratedChartDefinitions()
            .filter(definition => definition.chartType !== DASHBOARD_SLEEP_TREND_CHART_TYPE)
            .map((definition, index) => buildDashboardCuratedAutoTile(
                definition.chartType as DashboardDefaultCuratedChartType,
                startOrder + index,
            ));
    }

    private static getDefaultUserDashboardKpiTiles(startOrder: number): TileChartSettingsInterface[] {
        return getDefaultDashboardKpiChartDefinitions().map((definition, index) => buildDashboardKpiAutoTile(
            definition.chartType,
            startOrder + index,
        ));
    }

    private static getDefaultUserDashboardRecoveryTile(order: number): TileChartSettingsInterface {
        return buildDashboardCuratedAutoTile(DASHBOARD_RECOVERY_NOW_CHART_TYPE, order);
    }

    private static isRecoveryDashboardChartTile(tile: TileSettingsInterface): boolean {
        return tile.type === TileTypes.Chart && (
            isDashboardRecoveryNowChartType((tile as TileChartSettingsInterface).chartType)
            || (tile as TileChartSettingsInterface).dataType === DataRecoveryTime.type
        );
    }

    private static normalizeRecoveryDashboardChartTile(tile: TileChartSettingsInterface): TileChartSettingsInterface {
        const tileWithoutEventFilters = { ...(tile as AppDashboardChartTileSettingsInterface) };
        delete tileWithoutEventFilters.eventFilters;
        delete tileWithoutEventFilters.displaySettings;
        return {
            ...tileWithoutEventFilters,
            ...AppUserUtilities.getDefaultUserDashboardRecoveryTile(tile.order),
            order: Number.isFinite(Number(tile.order)) ? Number(tile.order) : 0,
            size: tile.size || { columns: 1, rows: 1 },
        };
    }

    private static normalizeDashboardChartTileDisplaySettings(tile: AppDashboardChartTileSettingsInterface): void {
        const normalizedDisplaySettings = normalizeDashboardChartTileDisplaySettingsForChartType(tile.chartType, tile.displaySettings, true);
        if (normalizedDisplaySettings) {
            tile.displaySettings = normalizedDisplaySettings;
            return;
        }
        delete tile.displaySettings;
    }

    static getDefaultMapLapTypes(): LapTypes[] {
        return [LapTypes.AutoLap, LapTypes.Distance, LapTypes.Manual];
    }

    static getDefaultChartLapTypes(): LapTypes[] {
        return [LapTypes.AutoLap, LapTypes.Distance, LapTypes.Manual];
    }

    static getDefaultDownSamplingLevel(): number {
        return 4;
    }

    static getDefaultGainAndLossThreshold(): number {
        return 1;
    }

    static getDefaultMapType(): MapTypes {
        return MapTypes.RoadMap;
    }

    static getDefaultDashboardMapStyle(): AppMapStyleName {
        return 'default';
    }

    static getDefaultDateRange(): DateRanges {
        return DateRanges.all;
    }

    static getDefaultXAxisType(): XAxisTypes {
        return XAxisTypes.Time;
    }

    static getDefaultSpeedUnits(): SpeedUnits[] {
        return [SpeedUnits.KilometersPerHour];
    }

    static getDefaultGradeAdjustedSpeedUnits(): GradeAdjustedSpeedUnits[] {
        return this.getGradeAdjustedSpeedUnitsFromSpeedUnits(this.getDefaultSpeedUnits());
    }

    static getGradeAdjustedSpeedUnitsFromSpeedUnits(speedUnits: SpeedUnits[]): GradeAdjustedSpeedUnits[] {
        return speedUnits.map(speedUnit => GradeAdjustedSpeedUnits[SpeedUnitsToGradeAdjustedSpeedUnits[speedUnit]]);
    }

    static getDefaultPaceUnits(): PaceUnits[] {
        return [PaceUnits.MinutesPerKilometer];
    }

    static getDefaultGradeAdjustedPaceUnits(): GradeAdjustedPaceUnits[] {
        return this.getGradeAdjustedPaceUnitsFromPaceUnits(this.getDefaultPaceUnits());
    }

    static getGradeAdjustedPaceUnitsFromPaceUnits(paceUnits: PaceUnits[]): GradeAdjustedPaceUnits[] {
        return paceUnits.map(paceUnit => GradeAdjustedPaceUnits[PaceUnitsToGradeAdjustedPaceUnits[paceUnit]]);
    }

    static getDefaultSwimPaceUnits(): SwimPaceUnits[] {
        return [SwimPaceUnits.MinutesPer100Meter];
    }

    static getDefaultVerticalSpeedUnits(): VerticalSpeedUnits[] {
        return [VerticalSpeedUnits.MetersPerSecond];
    }

    static getDefaultDistanceUnits(): DistanceUnits {
        return DistanceUnits.Kilometers;
    }

    static getDefaultUserUnitSettings(): UserUnitSettingsInterface {
        const unitSettings = <UserUnitSettingsInterface>{};
        unitSettings.speedUnits = AppUserUtilities.getDefaultSpeedUnits();
        unitSettings.gradeAdjustedSpeedUnits = AppUserUtilities.getDefaultGradeAdjustedSpeedUnits();
        unitSettings.paceUnits = AppUserUtilities.getDefaultPaceUnits();
        unitSettings.gradeAdjustedPaceUnits = AppUserUtilities.getDefaultGradeAdjustedPaceUnits();
        unitSettings.swimPaceUnits = AppUserUtilities.getDefaultSwimPaceUnits();
        unitSettings.verticalSpeedUnits = AppUserUtilities.getDefaultVerticalSpeedUnits();
        unitSettings.distanceUnits = AppUserUtilities.getDefaultDistanceUnits();
        unitSettings.startOfTheWeek = AppUserUtilities.getDefaultStartOfTheWeek();
        return unitSettings;
    }

    static getDefaultStartOfTheWeek(): DaysOfTheWeek {
        return DaysOfTheWeek.Monday;
    }

    static getDefaultChartStrokeWidth(): number {
        return 1.15;
    }

    static getDefaultChartStrokeOpacity(): number {
        return 1;
    }

    static getDefaultChartFillOpacity(): number {
        return 0;
    }

    static getDefaultSyncChartHoverToMap(): boolean {
        return false;
    }

    static getResolvedChartFillOpacity(chartSettings?: { fillOpacity?: number; fillOpacityVersion?: number } | null): number {
        if (chartSettings?.fillOpacityVersion === 1 && isNumber(chartSettings.fillOpacity)) {
            return Math.min(1, Math.max(0, Number(chartSettings.fillOpacity)));
        }

        return AppUserUtilities.getDefaultChartFillOpacity();
    }

    static getDefaultTableSettings(): TableSettings {
        return {
            eventsPerPage: 10,
            active: 'Start Date',
            direction: 'desc',
            selectedColumns: this.getDefaultSelectedTableColumns()
        }
    }

    private static normalizeTableColumnName(column: unknown): string | null {
        if (typeof column !== 'string') {
            return null;
        }

        const trimmedColumn = column.trim();
        if (!trimmedColumn) {
            return null;
        }

        const normalized = trimmedColumn.toLowerCase();
        const compact = normalized.replace(/\s+/g, '');

        if (normalized === 'startdate') {
            return 'Start Date';
        }

        if (compact === 'averageheartrate') {
            return DataHeartRateAvg.type;
        }

        return trimmedColumn;
    }

    private static normalizeTableSelectedColumns(columns: unknown): string[] {
        if (!Array.isArray(columns)) {
            return [];
        }

        const normalizedColumns: string[] = [];
        const seenColumns = new Set<string>();

        for (const column of columns) {
            const normalizedColumn = AppUserUtilities.normalizeTableColumnName(column);
            if (!normalizedColumn || seenColumns.has(normalizedColumn)) {
                continue;
            }
            seenColumns.add(normalizedColumn);
            normalizedColumns.push(normalizedColumn);
        }

        return normalizedColumns;
    }

    static getDefaultSelectedTableColumns(): string[] {
        return [
            DataDescription.type,
            DataActivityTypes.type,
            DataDuration.type,
            DataDistance.type,
            DataAscent.type,
            DataDescent.type,
            DataEnergy.type,
            DataHeartRateAvg.type,
            DataSpeedAvg.type,
            DataPowerAvg.type,
            // DataPowerMax.type,
            DataVO2Max.type,
            DataAerobicTrainingEffect.type,
            DataRecoveryTime.type,
            DataPeakEPOC.type,
            DataDeviceNames.type,
        ]
    }

    static getDefaultMyTracksDateRange(): DateRanges {
        return DateRanges.lastThirtyDays
    }

    static getDefaultActivityTypesToRemoveAscentFromSummaries(): ActivityTypes[] {
        return [ActivityTypes.AlpineSki, ActivityTypes.Snowboard]
    }

    public static fillMissingAppSettings(user: User): AppUserSettingsInterface {
        const settings: AppUserSettingsInterface = user.settings || {};
        const defaultTableSettings = AppUserUtilities.getDefaultTableSettings();
        const allDataTypes = getAppCanonicalChartDataTypes();

        // App
        settings.appSettings = settings.appSettings || <UserAppSettingsInterface>{};
        settings.appSettings.theme = settings.appSettings.theme || AppUserUtilities.getDefaultAppTheme();
        (settings.appSettings as AppUserSettingsInterface['appSettings']).dashboardActionPrompts = normalizeDashboardActionPrompts(
            (settings.appSettings as AppUserSettingsInterface['appSettings']).dashboardActionPrompts,
        );
        settings.deviceDisplaySettings = normalizeDeviceDisplaySettings(settings.deviceDisplaySettings);

        // Chart
        settings.chartSettings = settings.chartSettings || <UserChartSettingsInterface>{};
        const appChartSettings = settings.chartSettings as unknown as AppChartSettingsInterface;
        const existingDataTypeSettings = settings.chartSettings.dataTypeSettings || AppUserUtilities.getDefaultUserChartSettingsDataTypeSettings();
        const normalizedDataTypeSettings: DataTypeSettings = {};
        let hasEnabledDataType = false;
        for (const dataType of allDataTypes) {
            const enabled = existingDataTypeSettings[dataType]?.enabled === true;
            normalizedDataTypeSettings[dataType] = { enabled };
            if (enabled) {
                hasEnabledDataType = true;
            }
        }
        if (!hasEnabledDataType) {
            const fallbackDataTypes = AppUserUtilities.getDefaultChartDataTypesToShowOnLoad();
            for (const dataType of fallbackDataTypes) {
                if (normalizedDataTypeSettings[dataType]) {
                    normalizedDataTypeSettings[dataType].enabled = true;
                }
            }
        }
        settings.chartSettings.dataTypeSettings = normalizedDataTypeSettings;
        settings.chartSettings.useAnimations = settings.chartSettings.useAnimations === true;
        settings.chartSettings.xAxisType = XAxisTypes[settings.chartSettings.xAxisType] || AppUserUtilities.getDefaultXAxisType();
        settings.chartSettings.showAllData = settings.chartSettings.showAllData === true;
        settings.chartSettings.downSamplingLevel = settings.chartSettings.downSamplingLevel || AppUserUtilities.getDefaultDownSamplingLevel();
        settings.chartSettings.chartCursorBehaviour = settings.chartSettings.chartCursorBehaviour || AppUserUtilities.getDefaultChartCursorBehaviour();
        settings.chartSettings.strokeWidth = settings.chartSettings.strokeWidth || AppUserUtilities.getDefaultChartStrokeWidth();
        settings.chartSettings.strokeOpacity = isNumber(settings.chartSettings.strokeOpacity) ? settings.chartSettings.strokeOpacity : AppUserUtilities.getDefaultChartStrokeOpacity();
        settings.chartSettings.fillOpacity = isNumber(settings.chartSettings.fillOpacity) ? settings.chartSettings.fillOpacity : AppUserUtilities.getDefaultChartFillOpacity();
        settings.chartSettings.lapTypes = Array.isArray(settings.chartSettings.lapTypes) ? settings.chartSettings.lapTypes : AppUserUtilities.getDefaultChartLapTypes();
        settings.chartSettings.showLaps = settings.chartSettings.showLaps !== false;
        appChartSettings.showSwimLengths = appChartSettings.showSwimLengths !== false;
        appChartSettings.syncChartHoverToMap = appChartSettings.syncChartHoverToMap === true;
        appChartSettings.eventChartOverlayDataTypeByPrimary = normalizeEventChartOverlayDataTypeByPrimary(
            appChartSettings.eventChartOverlayDataTypeByPrimary,
        );
        settings.chartSettings.showGrid = settings.chartSettings.showGrid !== false;
        settings.chartSettings.stackYAxes = false;
        settings.chartSettings.disableGrouping = settings.chartSettings.disableGrouping === true;
        settings.chartSettings.hideAllSeriesOnInit = settings.chartSettings.hideAllSeriesOnInit === true;
        settings.chartSettings.gainAndLossThreshold = settings.chartSettings.gainAndLossThreshold || AppUserUtilities.getDefaultGainAndLossThreshold();

        // Units
        settings.unitSettings = settings.unitSettings || <UserUnitSettingsInterface>{};
        settings.unitSettings.speedUnits = Array.isArray(settings.unitSettings.speedUnits) && settings.unitSettings.speedUnits.length > 0
            ? settings.unitSettings.speedUnits
            : AppUserUtilities.getDefaultSpeedUnits();
        settings.unitSettings.paceUnits = Array.isArray(settings.unitSettings.paceUnits) && settings.unitSettings.paceUnits.length > 0
            ? settings.unitSettings.paceUnits
            : AppUserUtilities.getDefaultPaceUnits();
        settings.unitSettings.gradeAdjustedSpeedUnits = settings.unitSettings.gradeAdjustedSpeedUnits || AppUserUtilities.getGradeAdjustedSpeedUnitsFromSpeedUnits(settings.unitSettings.speedUnits);
        settings.unitSettings.gradeAdjustedPaceUnits = settings.unitSettings.gradeAdjustedPaceUnits || AppUserUtilities.getGradeAdjustedPaceUnitsFromPaceUnits(settings.unitSettings.paceUnits);
        settings.unitSettings.swimPaceUnits = Array.isArray(settings.unitSettings.swimPaceUnits) && settings.unitSettings.swimPaceUnits.length > 0
            ? settings.unitSettings.swimPaceUnits
            : AppUserUtilities.getDefaultSwimPaceUnits();
        settings.unitSettings.verticalSpeedUnits = Array.isArray(settings.unitSettings.verticalSpeedUnits) && settings.unitSettings.verticalSpeedUnits.length > 0
            ? settings.unitSettings.verticalSpeedUnits
            : AppUserUtilities.getDefaultVerticalSpeedUnits();
        settings.unitSettings.distanceUnits = normalizeDistanceUnits(
            settings.unitSettings.distanceUnits,
            AppUserUtilities.getDefaultDistanceUnits(),
        );
        settings.unitSettings.startOfTheWeek = isNumber(settings.unitSettings.startOfTheWeek) ? settings.unitSettings.startOfTheWeek : AppUserUtilities.getDefaultStartOfTheWeek();

        // Dashboard
        settings.dashboardSettings = settings.dashboardSettings || <AppDashboardSettingsInterface>{};
        const legacyDashboardDateRange = isNumber(settings.dashboardSettings.dateRange)
            ? settings.dashboardSettings.dateRange
            : null;
        settings.dashboardSettings.dateRange = legacyDashboardDateRange ?? AppUserUtilities.getDefaultDateRange();
        settings.dashboardSettings.startDate = settings.dashboardSettings.startDate || null;
        settings.dashboardSettings.endDate = settings.dashboardSettings.endDate || null;
        settings.dashboardSettings.activityTypes = settings.dashboardSettings.activityTypes || [];
        settings.dashboardSettings.includeMergedEvents = settings.dashboardSettings.includeMergedEvents !== false;
        settings.dashboardSettings.eventTableFilters = normalizeDashboardEventTableFilters(
            settings.dashboardSettings.eventTableFilters,
            {
                dateRange: legacyDashboardDateRange ?? DASHBOARD_EVENT_TABLE_DEFAULT_DATE_RANGE,
                startDate: settings.dashboardSettings.startDate,
                endDate: settings.dashboardSettings.endDate,
                activityTypes: settings.dashboardSettings.activityTypes,
                includeMergedEvents: settings.dashboardSettings.includeMergedEvents,
            },
        );
        settings.dashboardSettings.dismissedCuratedRecoveryNowTile = settings.dashboardSettings.dismissedCuratedRecoveryNowTile === true;
        settings.dashboardSettings.sleepTrend = {
            ...(settings.dashboardSettings.sleepTrend || {}),
            range: normalizeDashboardSleepTrendRange(settings.dashboardSettings.sleepTrend?.range),
        };
        settings.dashboardSettings.autoTiles = AppUserUtilities.normalizeDashboardAutoTiles(settings.dashboardSettings.autoTiles);
        settings.dashboardSettings.tiles = settings.dashboardSettings.tiles || AppUserUtilities.getDefaultUserDashboardTiles();
        let hasNormalizedRecoveryDashboardTile = false;
        let hasNormalizedMapDashboardTile = false;
        const legacyTileEventFilterRange = resolveLegacyDashboardTileEventFilterRange(
            settings.dashboardSettings.dateRange,
            settings.dashboardSettings.startDate,
            settings.dashboardSettings.endDate,
        );
        const legacyTileEventFilterActivityTypes = settings.dashboardSettings.activityTypes || [];
        const orderedDashboardTiles = [...settings.dashboardSettings.tiles]
            .sort((left: TileSettingsInterface, right: TileSettingsInterface) => Number(left?.order || 0) - Number(right?.order || 0));
        settings.dashboardSettings.tiles = orderedDashboardTiles
            .map((tile: TileSettingsInterface) => {
            if (tile.type === TileTypes.Chart) {
                const chartTile = tile as AppDashboardChartTileSettingsInterface;
                if (chartTile.chartType === ChartTypes.Spiral) {
                    chartTile.chartType = ChartTypes.LinesVertical;
                }

                if (AppUserUtilities.isRecoveryDashboardChartTile(chartTile)) {
                    if (hasNormalizedRecoveryDashboardTile) {
                        return null;
                    }
                    hasNormalizedRecoveryDashboardTile = true;
                    const normalizedRecoveryTile = AppUserUtilities.normalizeRecoveryDashboardChartTile(chartTile);
                    AppUserUtilities.normalizeDashboardChartTileDisplaySettings(normalizedRecoveryTile as AppDashboardChartTileSettingsInterface);
                    return normalizedRecoveryTile;
                }
                if (!isDashboardSpecialChartType(chartTile.chartType) || isDashboardEventBackedSpecialChartType(chartTile.chartType)) {
                    const eventBackedSpecial = isDashboardEventBackedSpecialChartType(chartTile.chartType);
                    chartTile.eventFilters = normalizeDashboardTileEventFilters(
                        chartTile.eventFilters,
                        eventBackedSpecial ? '1y' : legacyTileEventFilterRange,
                        eventBackedSpecial ? [] : legacyTileEventFilterActivityTypes,
                    );
                } else {
                    delete chartTile.eventFilters;
                }
                AppUserUtilities.normalizeDashboardChartTileDisplaySettings(chartTile);
                return chartTile;
            }

            if (tile.type !== TileTypes.Map) {
                return tile;
            }

            if (hasNormalizedMapDashboardTile) {
                return null;
            }
            hasNormalizedMapDashboardTile = true;

            const mapTile = tile as AppDashboardMapTileSettingsInterface;
            mapTile.mapStyle = mapTile.mapStyle || AppUserUtilities.getDefaultDashboardMapStyle();
            mapTile.eventFilters = normalizeDashboardTileEventFilters(
                mapTile.eventFilters,
                legacyTileEventFilterRange,
                legacyTileEventFilterActivityTypes,
            );
            delete mapTile.mapType;
            return mapTile;
        })
            .filter((tile): tile is TileSettingsInterface => tile !== null);
        if (hasNormalizedRecoveryDashboardTile) {
            settings.dashboardSettings.dismissedCuratedRecoveryNowTile = false;
        }
        // Patch missing defaults
        settings.dashboardSettings.tableSettings = settings.dashboardSettings.tableSettings || defaultTableSettings;
        settings.dashboardSettings.tableSettings.active = AppUserUtilities.normalizeTableColumnName(settings.dashboardSettings.tableSettings.active)
            || defaultTableSettings.active;
        settings.dashboardSettings.tableSettings.direction = settings.dashboardSettings.tableSettings.direction || defaultTableSettings.direction;
        settings.dashboardSettings.tableSettings.eventsPerPage = isNumber(settings.dashboardSettings.tableSettings.eventsPerPage)
            ? settings.dashboardSettings.tableSettings.eventsPerPage
            : defaultTableSettings.eventsPerPage;
        const normalizedSelectedColumns = AppUserUtilities.normalizeTableSelectedColumns(settings.dashboardSettings.tableSettings.selectedColumns);
        settings.dashboardSettings.tableSettings.selectedColumns = normalizedSelectedColumns.length > 0
            ? normalizedSelectedColumns
            : AppUserUtilities.getDefaultSelectedTableColumns();

        // Summaries
        settings.summariesSettings = settings.summariesSettings || <UserSummariesSettingsInterface>{};
        settings.summariesSettings.removeAscentForEventTypes = settings.summariesSettings.removeAscentForEventTypes || AppUserUtilities.getDefaultActivityTypesToRemoveAscentFromSummaries();

        // Map
        settings.mapSettings = settings.mapSettings || <AppMapSettingsInterface>{};
        settings.mapSettings.theme = settings.mapSettings.theme || MapThemes.Normal;
        settings.mapSettings.showLaps = settings.mapSettings.showLaps !== false;

        settings.mapSettings.showArrows = settings.mapSettings.showArrows !== false;
        settings.mapSettings.lapTypes = Array.isArray(settings.mapSettings.lapTypes) ? settings.mapSettings.lapTypes : AppUserUtilities.getDefaultMapLapTypes();
        settings.mapSettings.mapType = settings.mapSettings.mapType || AppUserUtilities.getDefaultMapType();
        settings.mapSettings.mapStyle = settings.mapSettings.mapStyle || 'default';
        settings.mapSettings.is3D = settings.mapSettings.is3D === true;
        settings.mapSettings.strokeWidth = settings.mapSettings.strokeWidth || AppUserUtilities.getDefaultMapStrokeWidth();
        delete (settings.mapSettings as any).showPoints;
        // MyTracks
        settings.myTracksSettings = settings.myTracksSettings || <UserMyTracksSettingsInterface>{};
        settings.myTracksSettings.dateRange = isNumber(settings.myTracksSettings.dateRange)
            ? settings.myTracksSettings.dateRange
            : AppUserUtilities.getDefaultMyTracksDateRange();
        const myTracksSettings = settings.myTracksSettings as AppMyTracksSettings;
        myTracksSettings.startDate = Number.isFinite(myTracksSettings.startDate) ? myTracksSettings.startDate : null;
        myTracksSettings.endDate = Number.isFinite(myTracksSettings.endDate) ? myTracksSettings.endDate : null;
        if (myTracksSettings.dateRange === DateRanges.custom && (myTracksSettings.startDate === null || myTracksSettings.endDate === null)) {
            myTracksSettings.dateRange = AppUserUtilities.getDefaultMyTracksDateRange();
        }
        (settings.myTracksSettings as any).showJumpHeatmap = (settings.myTracksSettings as any).showJumpHeatmap !== false;

        // Export to CSV
        settings.exportToCSVSettings = settings.exportToCSVSettings || <UserExportToCsvSettingsInterface>{};
        settings.exportToCSVSettings.startDate = settings.exportToCSVSettings.startDate !== false;
        settings.exportToCSVSettings.name = settings.exportToCSVSettings.name !== false;
        settings.exportToCSVSettings.description = settings.exportToCSVSettings.description !== false;
        settings.exportToCSVSettings.activityTypes = settings.exportToCSVSettings.activityTypes !== false;
        settings.exportToCSVSettings.distance = settings.exportToCSVSettings.distance !== false;
        settings.exportToCSVSettings.duration = settings.exportToCSVSettings.duration !== false;
        settings.exportToCSVSettings.ascent = settings.exportToCSVSettings.ascent !== false;
        settings.exportToCSVSettings.descent = settings.exportToCSVSettings.descent !== false;
        settings.exportToCSVSettings.calories = settings.exportToCSVSettings.calories !== false;
        settings.exportToCSVSettings.feeling = settings.exportToCSVSettings.feeling !== false;
        settings.exportToCSVSettings.rpe = settings.exportToCSVSettings.rpe !== false;
        settings.exportToCSVSettings.averageSpeed = settings.exportToCSVSettings.averageSpeed !== false;
        settings.exportToCSVSettings.averagePace = settings.exportToCSVSettings.averagePace !== false;
        settings.exportToCSVSettings.averageSwimPace = settings.exportToCSVSettings.averageSwimPace !== false;
        settings.exportToCSVSettings.averageGradeAdjustedPace = settings.exportToCSVSettings.averageGradeAdjustedPace !== false;
        settings.exportToCSVSettings.averageHeartRate = settings.exportToCSVSettings.averageHeartRate !== false;
        settings.exportToCSVSettings.maximumHeartRate = settings.exportToCSVSettings.maximumHeartRate !== false;
        settings.exportToCSVSettings.averagePower = settings.exportToCSVSettings.averagePower !== false;
        settings.exportToCSVSettings.maximumPower = settings.exportToCSVSettings.maximumPower !== false;
        settings.exportToCSVSettings.vO2Max = settings.exportToCSVSettings.vO2Max !== false;
        settings.exportToCSVSettings.includeLink = settings.exportToCSVSettings.includeLink !== false;

        settings.serviceSyncSettings = settings.serviceSyncSettings || {};
        const existingRouteSettings = settings.serviceSyncSettings.activitySyncRoutes || {};
        const normalizedRouteSettings: Partial<Record<ActivitySyncRouteId, { enabled?: boolean }>> = {};
        for (const routeID of Object.keys(ACTIVITY_SYNC_ROUTES) as ActivitySyncRouteId[]) {
            normalizedRouteSettings[routeID] = {
                enabled: existingRouteSettings[routeID]?.enabled === true,
            };
        }
        settings.serviceSyncSettings.activitySyncRoutes = normalizedRouteSettings;

        const existingRouteDeliverySettings = settings.serviceSyncSettings.routeDeliverySyncRoutes || {};
        const normalizedRouteDeliverySettings: Partial<Record<RouteDeliverySyncRouteId, { enabled?: boolean }>> = {};
        for (const routeID of Object.keys(ROUTE_DELIVERY_SYNC_ROUTES) as RouteDeliverySyncRouteId[]) {
            normalizedRouteDeliverySettings[routeID] = {
                enabled: existingRouteDeliverySettings[routeID]?.enabled === true,
            };
        }
        settings.serviceSyncSettings.routeDeliverySyncRoutes = normalizedRouteDeliverySettings;

        // @warning !!!!!! Enums with 0 as start value default to the override
        return settings;
    }

    /**
     * Returns true if the user's grace period is currently active.
     * Supports Firestore Timestamp, Date object, or Unix milliseconds.
     */
    public static isGracePeriodActive(user: AppUserInterface | User | null): boolean {
        if (!user) return false;
        const gracePeriodUntil = (user as any).gracePeriodUntil;
        if (!gracePeriodUntil) return false;

        // Handle Firestore Timestamp, Date, or Unix number from Claims
        const expiryMillis = typeof gracePeriodUntil.toMillis === 'function'
            ? gracePeriodUntil.toMillis()
            : typeof gracePeriodUntil.getTime === 'function'
                ? gracePeriodUntil.getTime()
                : typeof gracePeriodUntil === 'object' && gracePeriodUntil.seconds
                    ? gracePeriodUntil.seconds * 1000
                    : gracePeriodUntil;

        return expiryMillis > Date.now();
    }

    /**
     * Returns true if the user has Pro access. 
     * Pro access is granted if they are a Pro user OR have an active grace period.
     */
    public static hasProAccess(user: AppUserInterface | User | null, isAdmin: boolean = false): boolean {
        return AppUserUtilities.isProUser(user, isAdmin) || AppUserUtilities.isGracePeriodActive(user);
    }

    /**
     * Returns true if the user is a Pro user based on Stripe role, admin status, or legacy isPro flag.
     */
    public static isProUser(user: AppUserInterface | User | null, isAdmin: boolean = false): boolean {
        if (!user) return false;
        const stripeRole = (user as any).stripeRole;
        return stripeRole === 'pro' || isAdmin || (user as any).isPro === true;
    }

    /**
     * Returns true if the user is a Basic subscriber.
     */
    public static isBasicUser(user: User | null): boolean {
        if (!user) return false;
        const stripeRole = (user as any).stripeRole;
        return stripeRole === 'basic';
    }

    /**
     * Returns true if the user has any kind of paid access (Basic or Pro) or is in a Grace Period.
     * Also returns true for admins.
     */
    public static hasPaidAccessUser(user: AppUserInterface | User | null, isAdmin: boolean = false): boolean {
        if (!user) return false;
        if (isAdmin) return true;
        const stripeRole = (user as any).stripeRole;
        const isProFlag = (user as any).isPro === true;
        return stripeRole === 'basic' || stripeRole === 'pro' || isProFlag || AppUserUtilities.isGracePeriodActive(user);
    }

    private static normalizeDashboardAutoTiles(value: unknown): AppDashboardAutoTiles {
        if (!value || typeof value !== 'object') {
            return {};
        }

        return Object.entries(value as Record<string, unknown>)
            .reduce<AppDashboardAutoTiles>((normalized, [id, state]) => {
                const normalizedState = AppUserUtilities.normalizeDashboardAutoTileState(state);
                if (normalizedState) {
                    normalized[id] = normalizedState;
                }
                return normalized;
            }, {});
    }

    private static normalizeDashboardAutoTileState(value: unknown): AppDashboardAutoTileState | null {
        if (!value || typeof value !== 'object') {
            return null;
        }

        const state = value as Partial<AppDashboardAutoTileState>;
        if (state.state !== 'added' && state.state !== 'dismissed') {
            return null;
        }

        const normalized: AppDashboardAutoTileState = { state: state.state };
        const addedAt = AppUserUtilities.normalizeOptionalTimestamp(state.addedAt);
        const dismissedAt = AppUserUtilities.normalizeOptionalTimestamp(state.dismissedAt);
        const lastQualifiedAt = AppUserUtilities.normalizeOptionalTimestamp(state.lastQualifiedAt);
        const source = typeof state.source === 'string' ? state.source.trim() : '';

        if (addedAt !== null) {
            normalized.addedAt = addedAt;
        }
        if (dismissedAt !== null) {
            normalized.dismissedAt = dismissedAt;
        }
        if (lastQualifiedAt !== null) {
            normalized.lastQualifiedAt = lastQualifiedAt;
        }
        if (source) {
            normalized.source = source;
        }

        return normalized;
    }

    private static normalizeOptionalTimestamp(value: unknown): number | null {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0
            ? value
            : null;
    }
}
