import { Component, OnInit, inject, signal } from '@angular/core';
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
    fileType: string;
    originalFilename: string;
    routeCountLabel: string;
    pointCountLabel: string;
    waypointCountLabel: string | null;
    distance: RouteMetricCell;
    ascent: RouteMetricCell;
    descent: RouteMetricCell;
    minGrade: RouteMetricCell;
    maxGrade: RouteMetricCell;
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
    private logger = inject(LoggerService);
    private router = inject(Router);
    private readonly routeSortSubject = new BehaviorSubject<RouteSortState>({
        active: 'date',
        direction: 'desc',
    });

    readonly user = signal<User | null>(null);
    readonly deletingRouteID = signal<string | null>(null);
    readonly downloadingRouteID = signal<string | null>(null);
    readonly routeCount = signal<number | null>(null);
    readonly routeSortActive = signal<RouteSortColumn>('date');
    readonly routeSortDirection = signal<SortDirection>('desc');
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
            ]).pipe(
                map(([routes, routeSort]) => this.sortRouteViewModels(
                    routes.map(route => this.toRouteViewModel(route)),
                    routeSort,
                )),
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
        return {
            route,
            name: route.name || 'Untitled route',
            routeDate,
            routeDateSortMs: routeDate ? routeDate.getTime() : null,
            activityTypes,
            activityTypeSummaries,
            activityTypesTitle: activityTypeSummaries.map(summary => summary.activityTypeLabel).join('\n') || 'Route',
            fileType: route.srcFileType || 'route',
            originalFilename: file?.originalFilename || file?.path?.split('/').pop() || 'Original file',
            routeCountLabel: `${routeCount} route${routeCount === 1 ? '' : 's'}`,
            pointCountLabel: `${pointCount} point${pointCount === 1 ? '' : 's'}`,
            waypointCountLabel: waypointCount > 0 ? `${waypointCount} waypoint${waypointCount === 1 ? '' : 's'}` : null,
            distance: this.buildRouteMetricCell(route, [DataDistance.type, 'Distance', 'distance'], 'Distance', DataDistance.type, 'sum'),
            ascent: this.buildRouteMetricCell(route, [DataAscent.type, 'Ascent', 'ascent'], 'Ascent', DataAscent.type, 'sum'),
            descent: this.buildRouteMetricCell(route, [DataDescent.type, 'Descent', 'descent'], 'Descent', DataDescent.type, 'sum'),
            minGrade: this.buildRouteMetricCell(
                route,
                [DataGradeMin.type, 'minGrade', 'gradeMin', 'minimumGrade'],
                'Minimum grade',
                DataGradeMin.type,
                'min',
            ),
            maxGrade: this.buildRouteMetricCell(
                route,
                [DataGradeMax.type, 'maxGrade', 'gradeMax', 'maximumGrade'],
                'Maximum grade',
                DataGradeMax.type,
                'max',
            ),
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
