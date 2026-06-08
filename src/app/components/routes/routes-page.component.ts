import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom, BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Sort, SortDirection } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
    ActivityTypes,
    ActivityTypesHelper,
    DataAscent,
    DataDescent,
    DataDistance,
    DataGradeMax,
    DataGradeMin,
    User,
} from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { SharedModule } from '../../modules/shared.module';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppFileService } from '../../services/app.file.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppRouteService } from '../../services/app.route.service';
import { LoggerService } from '../../services/logger.service';
import { UploadRoutesComponent } from '../upload/upload-routes/upload-routes.component';

interface RoutePageRouteViewModel {
    route: FirestoreRouteJSON;
    name: string;
    routeDate: Date | null;
    routeDateSortMs: number | null;
    activityTypes: string;
    activityTypeSummaries: RouteActivityTypeSummary[];
    activityTypesTitle: string;
    activityTypeFilterValues: string[];
    fileType: string;
    fileTypeFilterValue: string;
    originalFilename: string;
    routeCountLabel: string;
    pointCountLabel: string;
    waypointCountLabel: string | null;
    distance: RouteMetricCell;
    ascent: RouteMetricCell;
    descent: RouteMetricCell;
    minGrade: RouteMetricCell;
    maxGrade: RouteMetricCell;
    filterText: string;
}

interface RouteMetricCell {
    label: string;
    sortValue: number | null;
    title: string;
}

interface RouteActivityTypeSummary {
    id: string;
    activityTypeLabel: string;
    activityTypeIconValue: string;
}

type RouteSortColumn =
    | 'date'
    | 'name'
    | 'activityTypes'
    | 'distance'
    | 'ascent'
    | 'descent'
    | 'minGrade'
    | 'maxGrade'
    | 'pointCount'
    | 'originalFilename';

type RouteMetricAggregation = 'sum' | 'min' | 'max';

interface RouteSortState {
    active: RouteSortColumn;
    direction: SortDirection;
}

interface RouteFilterState {
    text: string;
    fileType: string;
    activityType: string;
}

interface RouteFilterOption {
    value: string;
    label: string;
}

@Component({
    selector: 'app-routes-page',
    standalone: true,
    imports: [SharedModule, UploadRoutesComponent],
    templateUrl: './routes-page.component.html',
    styleUrls: ['./routes-page.component.scss'],
})
export class RoutesPageComponent implements OnInit {
    private authService = inject(AppAuthService);
    private routeService = inject(AppRouteService);
    private dialog = inject(MatDialog);
    private snackBar = inject(MatSnackBar);
    private fileService = inject(AppFileService);
    private analyticsService = inject(AppAnalyticsService);
    private hapticsService = inject(AppHapticsService);
    private logger = inject(LoggerService);
    private router = inject(Router);
    private readonly routeSortSubject = new BehaviorSubject<RouteSortState>({
        active: 'date',
        direction: 'desc',
    });
    private readonly routeFilterSubject = new BehaviorSubject<RouteFilterState>({
        text: '',
        fileType: '',
        activityType: '',
    });
    private readonly loadedRouteViewModels = signal<RoutePageRouteViewModel[]>([]);

    readonly user = signal<User | null>(null);
    readonly deletingRouteID = signal<string | null>(null);
    readonly downloadingRouteID = signal<string | null>(null);
    readonly routeCount = signal<number | null>(null);
    readonly loadedRouteCount = signal(0);
    readonly filteredRouteCount = signal(0);
    readonly routeFilter = signal('');
    readonly routeFileTypeFilter = signal('');
    readonly routeActivityTypeFilter = signal('');
    readonly routeFileTypeFilterOptions = signal<RouteFilterOption[]>([]);
    readonly routeActivityTypeFilterOptions = signal<RouteFilterOption[]>([]);
    readonly routeSortActive = signal<RouteSortColumn>('date');
    readonly routeSortDirection = signal<SortDirection>('desc');
    readonly routeFilterActive = computed(() => this.isRouteFilterActive());
    readonly routeResultSummary = computed(() => {
        const total = Math.max(this.routeCount() ?? 0, this.loadedRouteCount());
        const loaded = this.loadedRouteCount();
        const filtered = this.filteredRouteCount();
        if (loaded === 0 && total === 0) {
            return 'No routes';
        }
        if (this.isRouteFilterActive()) {
            return `${filtered} of ${loaded} loaded route${loaded === 1 ? '' : 's'}`;
        }
        if (loaded >= total) {
            return `${total} route${total === 1 ? '' : 's'}`;
        }
        const sortActive = this.routeSortActive() !== 'date' || this.routeSortDirection() !== 'desc';
        return `${loaded} of ${total} loaded${sortActive ? '; sorting loaded rows' : ''}`;
    });
    readonly routeColumns = [
        'date',
        'name',
        'activityTypes',
        'distance',
        'ascent',
        'descent',
        'minGrade',
        'maxGrade',
        'pointCount',
        'originalFilename',
        'actions',
    ];
    readonly routeHeaderDataTypes = {
        distance: DataDistance.type,
        ascent: DataAscent.type,
        descent: DataDescent.type,
        minGrade: DataGradeMin.type,
        maxGrade: DataGradeMax.type,
    };
    routes$: Observable<RoutePageRouteViewModel[]> | null = null;

    async ngOnInit(): Promise<void> {
        const user = await this.authService.getUser();
        this.user.set(user);
        if (user) {
            this.routes$ = combineLatest([
                this.routeService.getRoutes(user),
                this.routeSortSubject,
                this.routeFilterSubject,
            ]).pipe(
                map(([routes, routeSort, routeFilter]) => {
                    const routeViewModels = routes.map(route => this.toRouteViewModel(route));
                    this.loadedRouteViewModels.set(routeViewModels);
                    this.loadedRouteCount.set(routeViewModels.length);
                    this.routeFileTypeFilterOptions.set(this.buildRouteFileTypeFilterOptions(routeViewModels));
                    this.routeActivityTypeFilterOptions.set(this.buildRouteActivityTypeFilterOptions(routeViewModels));
                    const filteredRouteViewModels = this.filterRouteViewModels(routeViewModels, routeFilter);
                    this.filteredRouteCount.set(filteredRouteViewModels.length);
                    return this.sortRouteViewModels(filteredRouteViewModels, routeSort);
                }),
            );
            const routeCount = await this.refreshRouteCount();
            this.analyticsService.logSavedRouteAction('view', { routeCount });
        }
    }

    trackByRouteID(index: number, item: RoutePageRouteViewModel): string {
        return `${item.route.id || index}`;
    }

    onRouteSortChange(sort: Sort): void {
        const active = this.isRouteSortColumn(sort.active) ? sort.active : 'date';
        const direction = sort.direction || (active === 'date' ? 'desc' : 'asc');
        this.routeSortActive.set(active);
        this.routeSortDirection.set(direction);
        this.routeSortSubject.next({ active, direction });
        this.hapticsService.selection();
        this.analyticsService.logSavedRouteAction('sort', {
            sortColumn: active,
            sortDirection: direction === 'desc' ? 'desc' : 'asc',
            filterActive: this.isRouteFilterActive(),
            resultCount: this.filteredRouteCount(),
        });
    }

    updateRouteFilter(value: string): void {
        const wasFilterActive = this.isRouteFilterActive();
        this.routeFilter.set(value);
        this.emitRouteFilterState();
        if (this.isRouteFilterActive() !== wasFilterActive) {
            this.hapticsService.selection();
            this.analyticsService.logSavedRouteAction('filter', {
                status: this.isRouteFilterActive() ? 'applied' : 'cleared',
                filterActive: this.isRouteFilterActive(),
                resultCount: this.filteredRouteCount(),
            });
        }
    }

    updateRouteFileTypeFilter(value: string): void {
        if (this.routeFileTypeFilter() === value) {
            return;
        }
        this.routeFileTypeFilter.set(value);
        this.applyRouteFacetFilterChange();
    }

    updateRouteActivityTypeFilter(value: string): void {
        if (this.routeActivityTypeFilter() === value) {
            return;
        }
        this.routeActivityTypeFilter.set(value);
        this.applyRouteFacetFilterChange();
    }

    async refreshRouteCount(): Promise<number | null> {
        const user = this.user();
        if (!user) {
            this.routeCount.set(null);
            return null;
        }

        const count = await this.routeService.getRouteCount(user);
        this.routeCount.set(count);
        return count;
    }

    openRouteDetails(item: RoutePageRouteViewModel): void {
        const routeID = item.route.id;
        const userID = item.route.userID || this.user()?.uid;
        if (!routeID || !userID) {
            return;
        }

        this.analyticsService.logSavedRouteAction('open_details', {
            fileType: this.getPrimaryRouteFileType(item.route),
        });
        void this.router.navigate(['/user', userID, 'route', routeID]);
    }

    async confirmDeleteRoute(route: FirestoreRouteJSON): Promise<void> {
        const user = this.user();
        const routeID = route.id;
        if (!user || !routeID) {
            return;
        }

        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            data: {
                title: 'Delete route?',
                message: `Delete ${route.name || 'this route'} and its original file?`,
                confirmText: 'Delete',
                confirmColor: 'warn',
            } as ConfirmationDialogData,
        });

        const confirmed = await firstValueFrom(dialogRef.afterClosed());
        if (!confirmed) {
            return;
        }

        this.deletingRouteID.set(routeID);
        try {
            await this.routeService.deleteRoute(user, routeID);
            const routeCount = await this.refreshRouteCount();
            this.analyticsService.logSavedRouteAction('delete', {
                status: 'success',
                routeCount,
                fileType: this.getPrimaryRouteFileType(route),
            });
            this.snackBar.open('Route deleted.', undefined, { duration: 2500 });
        } catch (error) {
            this.analyticsService.logSavedRouteAction('delete', {
                status: 'failure',
                fileType: this.getPrimaryRouteFileType(route),
            });
            this.logger.error('[RoutesPageComponent] Failed to delete route', { routeID }, error);
            this.snackBar.open('Failed to delete route.', undefined, { duration: 3000 });
        } finally {
            this.deletingRouteID.set(null);
        }
    }

    async downloadRouteOriginals(route: FirestoreRouteJSON): Promise<void> {
        const routeID = route.id;
        if (!routeID) {
            return;
        }

        const originalFiles = this.routeService.getOriginalRouteFiles(route);
        if (originalFiles.length === 0) {
            this.analyticsService.logSavedRouteAction('download', {
                status: 'missing_file',
                fileCount: 0,
            });
            this.snackBar.open('No original route file found.', undefined, { duration: 3000 });
            return;
        }

        this.downloadingRouteID.set(routeID);
        this.snackBar.open('Preparing route download...', undefined, { duration: 2000 });
        try {
            const routeDate = this.resolveRouteDate(route);
            const baseName = this.sanitizeFilenameBase(route.name || routeID || 'route');

            if (originalFiles.length > 1) {
                const filesToZip: { data: ArrayBuffer; fileName: string }[] = [];
                for (let i = 0; i < originalFiles.length; i++) {
                    const fileMeta = originalFiles[i];
                    const extension = this.fileService.getExtensionFromPath(fileMeta.path, fileMeta.extension || 'gpx');
                    const fileDate = this.fileService.toDate(fileMeta.startDate) || routeDate;
                    const fileName = this.fileService.generateDateBasedFilename(fileDate, extension, i + 1, originalFiles.length, baseName);
                    filesToZip.push({
                        data: await this.routeService.downloadFile(fileMeta.path),
                        fileName,
                    });
                }

                await this.fileService.downloadAsZip(filesToZip, `${baseName}_originals.zip`);
                this.analyticsService.logSavedRouteAction('download', {
                    status: 'success',
                    fileCount: originalFiles.length,
                    fileType: this.getPrimaryRouteFileType(route),
                    zipped: true,
                });
                return;
            }

            const fileMeta = originalFiles[0];
            const extension = this.fileService.getExtensionFromPath(fileMeta.path, fileMeta.extension || 'gpx');
            const buffer = await this.routeService.downloadFile(fileMeta.path);
            this.fileService.downloadFile(new Blob([buffer]), baseName, extension);
            this.analyticsService.logSavedRouteAction('download', {
                status: 'success',
                fileCount: 1,
                fileType: extension,
                zipped: false,
            });
        } catch (error) {
            this.analyticsService.logSavedRouteAction('download', {
                status: 'failure',
                fileCount: originalFiles.length,
                fileType: this.getPrimaryRouteFileType(route),
                zipped: originalFiles.length > 1,
            });
            this.logger.error('[RoutesPageComponent] Failed to download route original file', { routeID }, error);
            this.snackBar.open('Failed to download route file.', undefined, { duration: 3000 });
        } finally {
            this.downloadingRouteID.set(null);
        }
    }

    private toDate(rawDate: unknown): Date | null {
        if (!rawDate) return null;
        if (rawDate instanceof Date) return rawDate;
        if (typeof (rawDate as { toDate?: unknown }).toDate === 'function') {
            return (rawDate as { toDate: () => Date }).toDate();
        }
        if (
            typeof (rawDate as { seconds?: unknown }).seconds === 'number'
            && typeof (rawDate as { nanoseconds?: unknown }).nanoseconds === 'number'
        ) {
            const timestamp = rawDate as { seconds: number; nanoseconds: number };
            return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000);
        }
        if (typeof rawDate === 'number') return new Date(rawDate);
        if (typeof rawDate === 'string') {
            const date = new Date(rawDate);
            return Number.isNaN(date.getTime()) ? null : date;
        }
        return null;
    }

    private toRouteViewModel(route: FirestoreRouteJSON): RoutePageRouteViewModel {
        const file = this.routeService.getOriginalRouteFiles(route)[0];
        const routeDate = this.resolveRouteDate(route);
        const routeCount = this.toFiniteNumber(route.routeCount) ?? 0;
        const pointCount = this.toFiniteNumber(route.pointCount) ?? 0;
        const waypointCount = this.toFiniteNumber(route.waypointCount) ?? 0;
        const activityTypeSummaries = this.buildRouteActivityTypeSummaries(route);
        const activityTypes = activityTypeSummaries.map(summary => summary.activityTypeLabel).join(', ') || 'Route';
        const originalFilename = file?.originalFilename || file?.path?.split('/').pop() || 'Original file';
        const fileType = route.srcFileType || file?.extension || 'route';
        const fileTypeFilterValue = this.normalizeFilterValue(fileType);
        const activityTypeFilterValues = this.getDistinctLabels(activityTypeSummaries.map(summary => summary.activityTypeLabel));
        const distance = this.buildRouteMetricCell(route, [DataDistance.type, 'Distance', 'distance'], 'Distance', DataDistance.type, 'sum');
        const ascent = this.buildRouteMetricCell(route, [DataAscent.type, 'Ascent', 'ascent'], 'Ascent', DataAscent.type, 'sum');
        const descent = this.buildRouteMetricCell(route, [DataDescent.type, 'Descent', 'descent'], 'Descent', DataDescent.type, 'sum');
        const minGrade = this.buildRouteMetricCell(
            route,
            [DataGradeMin.type, 'minGrade', 'gradeMin', 'minimumGrade'],
            'Minimum grade',
            DataGradeMin.type,
            'min',
        );
        const maxGrade = this.buildRouteMetricCell(
            route,
            [DataGradeMax.type, 'maxGrade', 'gradeMax', 'maximumGrade'],
            'Maximum grade',
            DataGradeMax.type,
            'max',
        );
        const routeName = route.name || 'Untitled route';
        const routeCountLabel = `${routeCount} route${routeCount === 1 ? '' : 's'}`;
        const pointCountLabel = `${pointCount} point${pointCount === 1 ? '' : 's'}`;
        const waypointCountLabel = waypointCount > 0 ? `${waypointCount} waypoint${waypointCount === 1 ? '' : 's'}` : null;
        return {
            route,
            name: routeName,
            routeDate,
            routeDateSortMs: routeDate ? routeDate.getTime() : null,
            activityTypes,
            activityTypeSummaries,
            activityTypeFilterValues,
            activityTypesTitle: activityTypeSummaries.map(summary => summary.activityTypeLabel).join('\n') || 'Route',
            fileType,
            fileTypeFilterValue,
            originalFilename,
            routeCountLabel,
            pointCountLabel,
            waypointCountLabel,
            distance,
            ascent,
            descent,
            minGrade,
            maxGrade,
            filterText: [
                routeName,
                activityTypes,
                originalFilename,
                fileType,
                routeDate ? routeDate.toISOString() : '',
                routeCountLabel,
                pointCountLabel,
                waypointCountLabel,
                distance.label,
                ascent.label,
                descent.label,
                minGrade.label,
                maxGrade.label,
            ].filter(Boolean).join(' ').toLowerCase(),
        };
    }

    private buildRouteActivityTypeSummaries(route: FirestoreRouteJSON): RouteActivityTypeSummary[] {
        const labels = this.getDistinctActivityTypeLabels(route.activityTypes || []);
        const activityTypeLabels = labels.length > 0 ? labels : ['Route'];
        return activityTypeLabels.map((activityTypeLabel, index) => ({
            id: `${this.normalizeActivityTypeSummaryID(activityTypeLabel) || 'route'}-${index}`,
            activityTypeLabel,
            activityTypeIconValue: activityTypeLabel,
        }));
    }

    private getDistinctActivityTypeLabels(activityTypes: unknown[]): string[] {
        const labels: string[] = [];
        const seenLabels = new Set<string>();
        activityTypes.forEach((activityType) => {
            const label = this.formatActivityTypeName(activityType);
            const labelKey = label.toLowerCase();
            if (!label || seenLabels.has(labelKey)) {
                return;
            }
            seenLabels.add(labelKey);
            labels.push(label);
        });
        return labels;
    }

    private formatActivityTypeName(type: unknown): string {
        if (typeof type === 'number') {
            const numericActivityType = (ActivityTypes as Record<string, string>)[String(type)];
            return numericActivityType || `${type}`;
        }

        if (typeof type !== 'string') {
            return '';
        }

        const raw = type.trim();
        if (!raw) {
            return '';
        }

        const resolvedActivityType = ActivityTypesHelper.resolveActivityType(raw);
        if (resolvedActivityType) {
            return resolvedActivityType;
        }

        const enumActivityType = (ActivityTypes as Record<string, string>)[raw];
        if (enumActivityType) {
            return enumActivityType;
        }

        if ((Object.values(ActivityTypes) as string[]).includes(raw)) {
            return raw;
        }

        const normalized = raw
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\s+/g, ' ');
        return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
    }

    private normalizeActivityTypeSummaryID(activityType: string): string {
        return activityType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    private getDistinctLabels(labels: string[]): string[] {
        const distinctLabels: string[] = [];
        const seenLabels = new Set<string>();
        labels.forEach((label) => {
            const normalizedLabel = `${label || ''}`.trim();
            const key = normalizedLabel.toLowerCase();
            if (!normalizedLabel || seenLabels.has(key)) {
                return;
            }
            seenLabels.add(key);
            distinctLabels.push(normalizedLabel);
        });
        return distinctLabels;
    }

    private resolveRouteDate(route: FirestoreRouteJSON): Date | null {
        return this.toDate(route.createdAt) || this.toDate(route.importedAt);
    }

    private buildRouteMetricCell(
        route: FirestoreRouteJSON,
        statAliases: string[],
        metricLabel: string,
        dataType: string,
        aggregation: RouteMetricAggregation,
    ): RouteMetricCell {
        const values = (Array.isArray(route.routes) ? route.routes : [])
            .map(segment => this.readRouteStatValue(segment.stats, statAliases))
            .filter((value): value is number => value !== null);
        const value = this.aggregateRouteMetricValues(values, aggregation);
        const label = value === null
            ? '-'
            : this.formatRouteMetricValue(dataType, value);

        return {
            label,
            sortValue: value,
            title: value === null ? `${metricLabel} unknown` : `${metricLabel}: ${label}`,
        };
    }

    private aggregateRouteMetricValues(values: number[], aggregation: RouteMetricAggregation): number | null {
        if (values.length === 0) {
            return null;
        }

        switch (aggregation) {
            case 'min':
                return Math.min(...values);
            case 'max':
                return Math.max(...values);
            case 'sum':
                return values.reduce((sum, value) => sum + value, 0);
        }
    }

    private readRouteStatValue(stats: Record<string, unknown> | undefined, aliases: string[]): number | null {
        if (!stats || typeof stats !== 'object') {
            return null;
        }

        for (const alias of aliases) {
            if (!Object.prototype.hasOwnProperty.call(stats, alias)) {
                continue;
            }

            const value = this.toFiniteNumber(stats[alias]);
            if (value !== null) {
                return value;
            }

            const rawStat = stats[alias];
            if (!rawStat || typeof rawStat !== 'object' || Array.isArray(rawStat)) {
                continue;
            }

            const statObject = rawStat as Record<string, unknown>;
            const objectValue = this.toFiniteNumber(statObject.value)
                ?? this.toFiniteNumber(statObject.rawValue)
                ?? this.toFiniteNumber(statObject._value);
            if (objectValue !== null) {
                return objectValue;
            }
        }

        return null;
    }

    private toFiniteNumber(value: unknown): number | null {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (typeof value === 'string') {
            const normalizedValue = value.trim();
            if (!normalizedValue) {
                return null;
            }
            const numericValue = Number(normalizedValue);
            return Number.isFinite(numericValue) ? numericValue : null;
        }
        return null;
    }

    private formatRouteMetricValue(dataType: string, value: number): string {
        return resolveUnitAwareDisplayFromValue(dataType, value, this.user()?.settings?.unitSettings ?? null, {
            stripRepeatedUnit: true,
            compactAscentDescent: true,
        })?.text ?? `${Math.round(value)}`;
    }

    private sortRouteViewModels(
        routes: RoutePageRouteViewModel[],
        routeSort: RouteSortState,
    ): RoutePageRouteViewModel[] {
        const direction = routeSort.direction || 'asc';
        return [...routes].sort((first, second) => {
            const result = this.compareRouteViewModels(first, second, routeSort.active, direction);
            return result !== 0 ? result : first.name.localeCompare(second.name, undefined, { sensitivity: 'base' });
        });
    }

    private compareRouteViewModels(
        first: RoutePageRouteViewModel,
        second: RoutePageRouteViewModel,
        active: RouteSortColumn,
        direction: SortDirection,
    ): number {
        switch (active) {
            case 'date':
                return this.compareNullableNumbers(first.routeDateSortMs, second.routeDateSortMs, direction);
            case 'name':
                return this.compareText(first.name, second.name, direction);
            case 'activityTypes':
                return this.compareText(first.activityTypes, second.activityTypes, direction);
            case 'distance':
                return this.compareNullableNumbers(first.distance.sortValue, second.distance.sortValue, direction);
            case 'ascent':
                return this.compareNullableNumbers(first.ascent.sortValue, second.ascent.sortValue, direction);
            case 'descent':
                return this.compareNullableNumbers(first.descent.sortValue, second.descent.sortValue, direction);
            case 'minGrade':
                return this.compareNullableNumbers(first.minGrade.sortValue, second.minGrade.sortValue, direction);
            case 'maxGrade':
                return this.compareNullableNumbers(first.maxGrade.sortValue, second.maxGrade.sortValue, direction);
            case 'pointCount':
                return this.compareNullableNumbers(
                    this.toFiniteNumber(first.route.pointCount),
                    this.toFiniteNumber(second.route.pointCount),
                    direction,
                );
            case 'originalFilename':
                return this.compareText(first.originalFilename, second.originalFilename, direction);
        }
    }

    private filterRouteViewModels(
        routes: RoutePageRouteViewModel[],
        routeFilter: RouteFilterState,
    ): RoutePageRouteViewModel[] {
        const text = routeFilter.text.trim().toLowerCase();
        const fileType = this.normalizeFilterValue(routeFilter.fileType);
        const activityType = this.normalizeFilterValue(routeFilter.activityType);
        if (!text && !fileType && !activityType) {
            return routes;
        }

        return routes.filter((route) => {
            if (text && !route.filterText.includes(text)) {
                return false;
            }
            if (fileType && route.fileTypeFilterValue !== fileType) {
                return false;
            }
            if (activityType && !route.activityTypeFilterValues.some(value => this.normalizeFilterValue(value) === activityType)) {
                return false;
            }
            return true;
        });
    }

    private buildRouteFileTypeFilterOptions(routes: RoutePageRouteViewModel[]): RouteFilterOption[] {
        return this.buildRouteFilterOptions(routes.map(route => route.fileType), label => label.toUpperCase());
    }

    private buildRouteActivityTypeFilterOptions(routes: RoutePageRouteViewModel[]): RouteFilterOption[] {
        return this.buildRouteFilterOptions(routes.flatMap(route => route.activityTypeFilterValues));
    }

    private buildRouteFilterOptions(
        values: string[],
        formatLabel: (label: string) => string = label => label,
    ): RouteFilterOption[] {
        const labelByValue = new Map<string, string>();
        values.forEach((value) => {
            const label = `${value || ''}`.trim();
            const normalizedValue = this.normalizeFilterValue(label);
            if (!label || !normalizedValue || labelByValue.has(normalizedValue)) {
                return;
            }
            labelByValue.set(normalizedValue, formatLabel(label));
        });
        return Array.from(labelByValue.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((first, second) => first.label.localeCompare(second.label, undefined, { sensitivity: 'base' }));
    }

    private emitRouteFilterState(): void {
        const routeFilterState = this.getRouteFilterState();
        this.filteredRouteCount.set(this.filterRouteViewModels(this.loadedRouteViewModels(), routeFilterState).length);
        this.routeFilterSubject.next(routeFilterState);
    }

    private getRouteFilterState(): RouteFilterState {
        return {
            text: this.routeFilter(),
            fileType: this.routeFileTypeFilter(),
            activityType: this.routeActivityTypeFilter(),
        };
    }

    private applyRouteFacetFilterChange(): void {
        this.emitRouteFilterState();
        this.hapticsService.selection();
        this.analyticsService.logSavedRouteAction('filter', {
            status: this.isRouteFilterActive() ? 'applied' : 'cleared',
            filterActive: this.isRouteFilterActive(),
            resultCount: this.filteredRouteCount(),
        });
    }

    private isRouteFilterActive(): boolean {
        return !!(
            this.routeFilter().trim()
            || this.routeFileTypeFilter()
            || this.routeActivityTypeFilter()
        );
    }

    private normalizeFilterValue(value: string): string {
        return `${value || ''}`.trim().toLowerCase();
    }

    private compareText(first: string, second: string, direction: SortDirection): number {
        const result = first.localeCompare(second, undefined, { sensitivity: 'base' });
        return direction === 'desc' ? -result : result;
    }

    private compareNullableNumbers(first: number | null, second: number | null, direction: SortDirection): number {
        if (first === null && second === null) return 0;
        if (first === null) return 1;
        if (second === null) return -1;
        const result = first - second;
        return direction === 'desc' ? -result : result;
    }

    private isRouteSortColumn(value: string): value is RouteSortColumn {
        return [
            'date',
            'name',
            'activityTypes',
            'distance',
            'ascent',
            'descent',
            'minGrade',
            'maxGrade',
            'pointCount',
            'originalFilename',
        ].includes(value);
    }

    private sanitizeFilenameBase(value: string): string {
        const sanitized = value
            .trim()
            .replace(/[\\/:*?"<>|]+/g, '-')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^[-_.]+|[-_.]+$/g, '');
        return sanitized || 'route';
    }

    private getPrimaryRouteFileType(route: FirestoreRouteJSON): string {
        const file = this.routeService.getOriginalRouteFiles(route)[0];
        return this.fileService.getExtensionFromPath(file?.path || '', file?.extension || route.srcFileType || 'route');
    }
}
