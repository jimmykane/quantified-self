import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  AppThemes,
  RouteFileInterface,
  User,
} from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '@shared/app-route.interface';
import { SharedModule } from '../../../modules/shared.module';
import { RouteResolverData } from '../../../resolvers/route.resolver';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppRouteService } from '../../../services/app.route.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { LoggerService } from '../../../services/logger.service';
import { normalizeRouteName } from '../../../helpers/route-name.helper';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../../confirmation-dialog/confirmation-dialog.component';
import { RouteChartComponent } from '../route-chart/route-chart.component';
import { RouteMapComponent } from '../route-map/route-map.component';
import { RouteNameDialogComponent, RouteNameDialogData } from '../route-name-dialog/route-name-dialog.component';
import {
  buildRouteSegmentDetailViews,
  buildRouteSummaryMetrics,
  buildRouteWaypointDetailViews,
  buildRouteWaypointDisplayViews,
  filterRouteWaypointsForSegments,
  RouteSegmentDetailView,
} from '../../../helpers/route-detail.helper';

@Component({
  selector: 'app-route-detail',
  standalone: true,
  imports: [SharedModule, RouteMapComponent, RouteChartComponent],
  templateUrl: './route-detail.component.html',
  styleUrls: ['./route-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteDetailComponent {
  private activatedRoute = inject(ActivatedRoute);
  private router = inject(Router);
  private routeService = inject(AppRouteService);
  private fileService = inject(AppFileService);
  private analyticsService = inject(AppAnalyticsService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private themeService = inject(AppThemeService);

  readonly routeDocument = signal<FirestoreRouteJSON | null>(null);
  readonly routeFile = signal<RouteFileInterface | null>(null);
  readonly sourceFile = signal<OriginalRouteFileMetaData | null>(null);
  readonly user = signal<User | null>(null);
  readonly selectedSegmentIDs = signal<string[]>([]);
  readonly renaming = signal(false);
  readonly downloading = signal(false);
  readonly deleting = signal(false);

  readonly unitSettings = this.userSettingsQuery.unitSettings;
  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly routeName = computed(() => this.routeDocument()?.name || this.routeFile()?.name || 'Untitled route');
  readonly routeDate = computed(() => this.resolveRouteDate());
  readonly sourceFilename = computed(() => this.getSourceFilename());
  readonly sourceFileType = computed(() => this.getPrimaryRouteFileType(this.routeDocument()));
  readonly activityType = computed(() => {
    const segments = this.segments();
    return segments[0]?.activityType || this.routeDocument()?.activityTypes?.[0] || 'Route';
  });
  readonly segments = computed(() => {
    const routeDocument = this.routeDocument();
    const routeFile = this.routeFile();
    if (!routeDocument || !routeFile) {
      return [];
    }
    return buildRouteSegmentDetailViews(routeDocument, routeFile, this.unitSettings());
  });
  readonly selectedSegments = computed(() => {
    const selectedIDs = new Set(this.selectedSegmentIDs());
    return this.segments().filter(segment => selectedIDs.has(segment.id));
  });
  readonly selectedSegmentIDSet = computed(() => new Set(this.selectedSegmentIDs()));
  readonly allSegmentsSelected = computed(() => this.selectedSegments().length === this.segments().length);
  readonly segmentSelectionLabel = computed(() => {
    const segmentCount = this.segments().length;
    if (segmentCount === 0) {
      return 'No segments';
    }
    return `${this.selectedSegments().length}/${segmentCount} visible`;
  });
  readonly summaryMetrics = computed(() => {
    const routeDocument = this.routeDocument();
    if (!routeDocument) {
      return [];
    }
    return buildRouteSummaryMetrics(routeDocument, this.segments(), this.unitSettings());
  });
  readonly waypoints = computed(() => {
    const routeFile = this.routeFile();
    if (!routeFile) {
      return [];
    }
    return buildRouteWaypointDetailViews(routeFile, this.unitSettings());
  });
  readonly selectedWaypoints = computed(() => filterRouteWaypointsForSegments(this.waypoints(), this.selectedSegments()));
  readonly waypointDisplayViews = computed(() => buildRouteWaypointDisplayViews(this.selectedWaypoints(), this.selectedSegments()));
  readonly canManageRoute = computed(() => {
    const user = this.user();
    const routeDocument = this.routeDocument();
    return !!user?.uid && !!routeDocument?.userID && user.uid === routeDocument.userID;
  });

  constructor() {
    this.activatedRoute.data
      .pipe(takeUntilDestroyed())
      .subscribe((data) => this.applyResolvedRouteData(data['route'] as RouteResolverData | null));
  }

  onSegmentVisibilityChange(segmentID: string, checked: boolean): void {
    const selectedIDs = this.selectedSegmentIDs();
    if (checked) {
      const selectedIDSet = new Set([...selectedIDs, segmentID]);
      this.selectedSegmentIDs.set(this.segments()
        .map(segment => segment.id)
        .filter(id => selectedIDSet.has(id)));
      return;
    }

    if (selectedIDs.length <= 1 && selectedIDs.includes(segmentID)) {
      return;
    }

    this.selectedSegmentIDs.set(selectedIDs.filter(id => id !== segmentID));
  }

  selectAllSegments(): void {
    this.selectedSegmentIDs.set(this.segments().map(segment => segment.id));
  }

  async renameRoute(): Promise<void> {
    const routeDocument = this.routeDocument();
    const routeID = routeDocument?.id;
    const user = this.user();
    if (!routeDocument || !routeID || !user || this.renaming() || !this.canManageRoute()) {
      return;
    }

    const currentName = normalizeRouteName(routeDocument.name || this.routeFile()?.name || '');
    const dialogRef = this.dialog.open(RouteNameDialogComponent, {
      width: '420px',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        currentName,
      } as RouteNameDialogData,
    });

    const routeName = await firstValueFrom(dialogRef.afterClosed());
    if (typeof routeName !== 'string') {
      return;
    }

    const normalizedRouteName = normalizeRouteName(routeName);
    if (!normalizedRouteName || normalizedRouteName === currentName) {
      return;
    }

    this.renaming.set(true);
    this.updateCurrentRouteName(routeID, normalizedRouteName);
    try {
      await this.routeService.updateRouteName(user, routeID, normalizedRouteName);
      this.analyticsService.logSavedRouteAction('rename', {
        status: 'success',
        fileType: this.getPrimaryRouteFileType(routeDocument),
      });
      this.snackBar.open('Route name saved.', undefined, { duration: 2500 });
    } catch (error) {
      this.updateCurrentRouteName(routeID, currentName);
      this.analyticsService.logSavedRouteAction('rename', {
        status: 'failure',
        fileType: this.getPrimaryRouteFileType(routeDocument),
      });
      this.logger.error('[RouteDetailComponent] Failed to rename route', { routeID }, error);
      this.snackBar.open('Failed to save route name.', undefined, { duration: 3000 });
    } finally {
      this.renaming.set(false);
    }
  }

  async downloadRouteOriginals(): Promise<void> {
    const routeDocument = this.routeDocument();
    if (!routeDocument?.id || this.downloading() || !this.canManageRoute()) {
      return;
    }

    const originalFiles = this.routeService.getOriginalRouteFiles(routeDocument);
    if (originalFiles.length === 0) {
      this.analyticsService.logSavedRouteAction('download', {
        status: 'missing_file',
        fileCount: 0,
      });
      this.snackBar.open('No original route file found.', undefined, { duration: 3000 });
      return;
    }

    this.downloading.set(true);
    this.snackBar.open('Preparing route download...', undefined, { duration: 2000 });
    try {
      const routeDate = this.routeDate();
      const baseName = this.sanitizeFilenameBase(routeDocument.name || routeDocument.id || 'route');

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
          fileType: this.getPrimaryRouteFileType(routeDocument),
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
        fileType: this.getPrimaryRouteFileType(routeDocument),
        zipped: originalFiles.length > 1,
      });
      this.logger.error('[RouteDetailComponent] Failed to download route original file', { routeID: routeDocument.id }, error);
      this.snackBar.open('Failed to download route file.', undefined, { duration: 3000 });
    } finally {
      this.downloading.set(false);
    }
  }

  async confirmDeleteRoute(): Promise<void> {
    const routeDocument = this.routeDocument();
    const routeID = routeDocument?.id;
    const user = this.user();
    if (!routeDocument || !routeID || !user || this.deleting() || !this.canManageRoute()) {
      return;
    }

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Delete route?',
        message: `Delete ${routeDocument.name || 'this route'} and its original file?`,
        confirmText: 'Delete',
        confirmColor: 'warn',
      } as ConfirmationDialogData,
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) {
      return;
    }

    this.deleting.set(true);
    try {
      await this.routeService.deleteRoute(user, routeID);
      this.analyticsService.logSavedRouteAction('delete', {
        status: 'success',
        fileType: this.getPrimaryRouteFileType(routeDocument),
      });
      this.snackBar.open('Route deleted.', undefined, { duration: 2500 });
      await this.router.navigate(['/routes']);
    } catch (error) {
      this.analyticsService.logSavedRouteAction('delete', {
        status: 'failure',
        fileType: this.getPrimaryRouteFileType(routeDocument),
      });
      this.logger.error('[RouteDetailComponent] Failed to delete route', { routeID }, error);
      this.snackBar.open('Failed to delete route.', undefined, { duration: 3000 });
    } finally {
      this.deleting.set(false);
    }
  }

  private applyResolvedRouteData(data: RouteResolverData | null): void {
    if (!data) {
      return;
    }

    this.routeDocument.set(data.routeDocument);
    this.routeFile.set(data.routeFile);
    this.sourceFile.set(data.sourceFile);
    this.user.set(data.user);

    const segmentIDs = buildRouteSegmentDetailViews(data.routeDocument, data.routeFile, this.unitSettings())
      .map((segment: RouteSegmentDetailView) => segment.id);
    this.selectedSegmentIDs.set(segmentIDs);
    this.analyticsService.logSavedRouteAction('open_details', {
      fileType: this.getPrimaryRouteFileType(data.routeDocument),
      fileCount: this.routeService.getOriginalRouteFiles(data.routeDocument).length,
    });
  }

  private updateCurrentRouteName(routeID: string, name: string): void {
    this.routeDocument.update(routeDocument =>
      routeDocument?.id === routeID
        ? { ...routeDocument, name }
        : routeDocument,
    );
  }

  private resolveRouteDate(): Date | null {
    const routeFile = this.routeFile();
    const routeDocument = this.routeDocument();
    const sourceFile = this.sourceFile();
    return this.toDate(routeFile?.createdAt)
      || this.toDate(routeDocument?.createdAt)
      || this.toDate(routeDocument?.importedAt)
      || this.toDate(sourceFile?.startDate);
  }

  private getSourceFilename(): string {
    const sourceFile = this.sourceFile();
    return sourceFile?.originalFilename
      || sourceFile?.path?.split('/').pop()
      || 'Original route file';
  }

  private getPrimaryRouteFileType(route: FirestoreRouteJSON | null): string {
    if (!route) {
      return 'route';
    }
    const file = this.routeService.getOriginalRouteFiles(route)[0];
    return this.fileService.getExtensionFromPath(file?.path || '', file?.extension || route.srcFileType || 'route');
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

  private sanitizeFilenameBase(value: string): string {
    const sanitized = value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[-_.]+|[-_.]+$/g, '');
    return sanitized || 'route';
  }
}
