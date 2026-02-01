import {
    ActivityTypes,
    AppThemes,
    ChartCursorBehaviours,
    ChartDataCategoryTypes,
    ChartDataValueTypes,
    ChartThemes,
    ChartTypes,
    DataTypeSettings,
    DateRanges,
    DaysOfTheWeek,
    DynamicDataLoader,
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
    UserDashboardSettingsInterface,
    UserMapSettingsInterface,
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
    UserSettingsInterface,
} from '@sports-alliance/sports-lib';
import { isNumber } from 'lodash-es';
import { AppUserInterface, AppUserSettingsInterface } from '../models/app-user.interface';
import { StripeRole } from '../models/stripe-role.model';

/**
 * Utility class for AppUser related static methods and default settings.
 * This class handles non-reactive logic such as subscription status checks
 * and providing default application/user settings.
 */
export class AppUserUtilities {

    /**
     * Returns the default chart theme.
     */
    static getDefaultChartTheme(): ChartThemes {
        return ChartThemes.Material;
    }

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
        return DynamicDataLoader.basicDataTypes.reduce((dataTypeSettings: DataTypeSettings, dataTypeToUse: string) => {
            dataTypeSettings[dataTypeToUse] = { enabled: true };
            return dataTypeSettings
        }, {})
    }

    static getDefaultUserDashboardChartTile(): TileChartSettingsInterface {
        return {
            name: 'Distance',
            order: 0,
            type: TileTypes.Chart,
            chartType: ChartTypes.ColumnsHorizontal,
            dataType: DataDistance.type,
            dataTimeInterval: TimeIntervals.Auto,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            dataValueType: ChartDataValueTypes.Total,
            size: { columns: 1, rows: 1 },
        };
    }

    static getDefaultUserDashboardMapTile(): TileMapSettingsInterface {
        return {
            name: 'Clustered HeatMap',
            order: 0,
            type: TileTypes.Map,
            mapType: MapTypes.Terrain,
            mapTheme: MapThemes.Normal,
            showHeatMap: true,
            clusterMarkers: true,
            size: { columns: 1, rows: 1 },
        };
    }

    static getDefaultUserDashboardTiles(): TileSettingsInterface[] {
        return [<TileMapSettingsInterface>{
            name: 'Clustered HeatMap',
            order: 0,
            type: TileTypes.Map,
            mapType: MapTypes.RoadMap,
            mapTheme: MapThemes.Normal,
            showHeatMap: true,
            clusterMarkers: true,
            size: { columns: 1, rows: 1 },
        }, <TileChartSettingsInterface>{
            name: 'Duration',
            order: 1,
            type: TileTypes.Chart,
            chartType: ChartTypes.Pie,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            dataType: DataDuration.type,
            dataTimeInterval: TimeIntervals.Auto,
            dataValueType: ChartDataValueTypes.Total,
            size: { columns: 1, rows: 1 },
        }, <TileChartSettingsInterface>{
            name: 'Distance',
            order: 2,
            type: TileTypes.Chart,
            chartType: ChartTypes.ColumnsHorizontal,
            dataType: DataDistance.type,
            dataTimeInterval: TimeIntervals.Auto,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            dataValueType: ChartDataValueTypes.Total,
            size: { columns: 1, rows: 1 },
        }, <TileChartSettingsInterface>{
            name: 'Ascent',
            order: 3,
            type: TileTypes.Chart,
            chartType: ChartTypes.PyramidsVertical,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            dataType: DataAscent.type,
            dataTimeInterval: TimeIntervals.Auto,
            dataValueType: ChartDataValueTypes.Total,
            size: { columns: 1, rows: 1 },
        }]
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

    static getDefaultExtraMaxForPower(): number {
        return 0;
    }

    static getDefaultExtraMaxForPace(): number {
        return -0.25;
    }

    static getDefaultMapType(): MapTypes {
        return MapTypes.RoadMap;
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

    static getDefaultUserUnitSettings(): UserUnitSettingsInterface {
        const unitSettings = <UserUnitSettingsInterface>{};
        unitSettings.speedUnits = AppUserUtilities.getDefaultSpeedUnits();
        unitSettings.gradeAdjustedSpeedUnits = AppUserUtilities.getDefaultGradeAdjustedSpeedUnits();
        unitSettings.paceUnits = AppUserUtilities.getDefaultPaceUnits();
        unitSettings.gradeAdjustedPaceUnits = AppUserUtilities.getDefaultGradeAdjustedPaceUnits();
        unitSettings.swimPaceUnits = AppUserUtilities.getDefaultSwimPaceUnits();
        unitSettings.verticalSpeedUnits = AppUserUtilities.getDefaultVerticalSpeedUnits();
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
        return 0.35;
    }

    static getDefaultTableSettings(): TableSettings {
        return {
            eventsPerPage: 10,
            active: 'startDate',
            direction: 'desc',
            selectedColumns: this.getDefaultSelectedTableColumns()
        }
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

    public static fillMissingAppSettings(user: User): UserSettingsInterface {
        const settings: UserSettingsInterface = user.settings || {};
        // App
        settings.appSettings = settings.appSettings || <UserAppSettingsInterface>{};
        settings.appSettings.theme = settings.appSettings.theme || AppUserUtilities.getDefaultAppTheme();
        // Chart
        settings.chartSettings = settings.chartSettings || <UserChartSettingsInterface>{};
        settings.chartSettings.dataTypeSettings = settings.chartSettings.dataTypeSettings || AppUserUtilities.getDefaultUserChartSettingsDataTypeSettings();
        settings.chartSettings.theme = settings.chartSettings.theme || AppUserUtilities.getDefaultChartTheme();
        settings.chartSettings.useAnimations = settings.chartSettings.useAnimations === true;
        settings.chartSettings.xAxisType = XAxisTypes[settings.chartSettings.xAxisType] || AppUserUtilities.getDefaultXAxisType();
        settings.chartSettings.showAllData = settings.chartSettings.showAllData === true;
        settings.chartSettings.downSamplingLevel = settings.chartSettings.downSamplingLevel || AppUserUtilities.getDefaultDownSamplingLevel();
        settings.chartSettings.chartCursorBehaviour = settings.chartSettings.chartCursorBehaviour || AppUserUtilities.getDefaultChartCursorBehaviour();
        settings.chartSettings.strokeWidth = settings.chartSettings.strokeWidth || AppUserUtilities.getDefaultChartStrokeWidth();
        settings.chartSettings.strokeOpacity = isNumber(settings.chartSettings.strokeOpacity) ? settings.chartSettings.strokeOpacity : AppUserUtilities.getDefaultChartStrokeOpacity();
        settings.chartSettings.fillOpacity = isNumber(settings.chartSettings.fillOpacity) ? settings.chartSettings.fillOpacity : AppUserUtilities.getDefaultChartFillOpacity();
        settings.chartSettings.extraMaxForPower = isNumber(settings.chartSettings.extraMaxForPower) ? settings.chartSettings.extraMaxForPower : AppUserUtilities.getDefaultExtraMaxForPower();
        settings.chartSettings.extraMaxForPace = isNumber(settings.chartSettings.extraMaxForPace) ? settings.chartSettings.extraMaxForPace : AppUserUtilities.getDefaultExtraMaxForPace();
        settings.chartSettings.lapTypes = settings.chartSettings.lapTypes || AppUserUtilities.getDefaultChartLapTypes();
        settings.chartSettings.showLaps = settings.chartSettings.showLaps !== false;
        settings.chartSettings.showGrid = settings.chartSettings.showGrid !== false;
        settings.chartSettings.stackYAxes = settings.chartSettings.stackYAxes !== false;
        settings.chartSettings.disableGrouping = settings.chartSettings.disableGrouping === true;
        settings.chartSettings.hideAllSeriesOnInit = settings.chartSettings.hideAllSeriesOnInit === true;
        settings.chartSettings.gainAndLossThreshold = settings.chartSettings.gainAndLossThreshold || AppUserUtilities.getDefaultGainAndLossThreshold();
        // Units
        settings.unitSettings = settings.unitSettings || <UserUnitSettingsInterface>{};
        settings.unitSettings.speedUnits = settings.unitSettings.speedUnits || AppUserUtilities.getDefaultSpeedUnits();
        settings.unitSettings.paceUnits = settings.unitSettings.paceUnits || AppUserUtilities.getDefaultPaceUnits();
        settings.unitSettings.gradeAdjustedSpeedUnits = settings.unitSettings.gradeAdjustedSpeedUnits || AppUserUtilities.getGradeAdjustedSpeedUnitsFromSpeedUnits(settings.unitSettings.speedUnits);
        settings.unitSettings.gradeAdjustedPaceUnits = settings.unitSettings.gradeAdjustedPaceUnits || AppUserUtilities.getGradeAdjustedPaceUnitsFromPaceUnits(settings.unitSettings.paceUnits);
        settings.unitSettings.swimPaceUnits = settings.unitSettings.swimPaceUnits || AppUserUtilities.getDefaultSwimPaceUnits();
        settings.unitSettings.verticalSpeedUnits = settings.unitSettings.verticalSpeedUnits || AppUserUtilities.getDefaultVerticalSpeedUnits()
        settings.unitSettings.startOfTheWeek = isNumber(settings.unitSettings.startOfTheWeek) ? settings.unitSettings.startOfTheWeek : AppUserUtilities.getDefaultStartOfTheWeek();
        // Dashboard
        settings.dashboardSettings = settings.dashboardSettings || <UserDashboardSettingsInterface>{};
        settings.dashboardSettings.dateRange = isNumber(settings.dashboardSettings.dateRange) ? settings.dashboardSettings.dateRange : AppUserUtilities.getDefaultDateRange();
        settings.dashboardSettings.startDate = settings.dashboardSettings.startDate || null;
        settings.dashboardSettings.endDate = settings.dashboardSettings.endDate || null;
        settings.dashboardSettings.activityTypes = settings.dashboardSettings.activityTypes || [];
        settings.dashboardSettings.tiles = settings.dashboardSettings.tiles || AppUserUtilities.getDefaultUserDashboardTiles();
        // Patch missing defaults
        settings.dashboardSettings.tableSettings = settings.dashboardSettings.tableSettings || AppUserUtilities.getDefaultTableSettings();
        settings.dashboardSettings.tableSettings.selectedColumns = settings.dashboardSettings.tableSettings.selectedColumns || AppUserUtilities.getDefaultSelectedTableColumns()

        // Summaries
        settings.summariesSettings = settings.summariesSettings || <UserSummariesSettingsInterface>{};
        settings.summariesSettings.removeAscentForEventTypes = settings.summariesSettings.removeAscentForEventTypes || AppUserUtilities.getDefaultActivityTypesToRemoveAscentFromSummaries();
        // Map
        settings.mapSettings = settings.mapSettings || <UserMapSettingsInterface>{};
        settings.mapSettings.theme = settings.mapSettings.theme || MapThemes.Normal;
        settings.mapSettings.showLaps = settings.mapSettings.showLaps !== false;

        settings.mapSettings.showArrows = settings.mapSettings.showArrows !== false;
        settings.mapSettings.lapTypes = settings.mapSettings.lapTypes || AppUserUtilities.getDefaultMapLapTypes();
        settings.mapSettings.mapType = settings.mapSettings.mapType || AppUserUtilities.getDefaultMapType();
        settings.mapSettings.strokeWidth = settings.mapSettings.strokeWidth || AppUserUtilities.getDefaultMapStrokeWidth();
        // MyTracks
        settings.myTracksSettings = settings.myTracksSettings || <UserMyTracksSettingsInterface>{};
        settings.myTracksSettings.dateRange = isNumber(settings.myTracksSettings.dateRange)
            ? settings.myTracksSettings.dateRange
            : AppUserUtilities.getDefaultMyTracksDateRange();

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
}
