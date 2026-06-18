import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, map, switchMap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  AppThemes,
  RouteFileInterface,
  ServiceNames,
  User,
} from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '@shared/app-route.interface';
import { SharedModule } from '../../../modules/shared.module';
import { RouteResolverData } from '../../../resolvers/route.resolver';
import { buildSuuntoServiceConnectionViewModel, SuuntoServiceConnectionViewModel } from '../../../helpers/suunto-service-connection.helper';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppOriginalFileDownloadService } from '../../../services/app.original-file-download.service';
import { AppProcessingService } from '../../../services/app.processing.service';
import { AppRouteGPXExportService } from '../../../services/app.route-gpx-export.service';
import {
  AppRouteReprocessService,
  getRouteReprocessErrorMessage,
  getRouteReprocessProgressTitle,
  RouteReprocessProgress,
} from '../../../services/app.route-reprocess.service';
import {
  AppRouteSendService,
  getRouteSendErrorMessage,
  getRouteSendResponseMessage,
} from '../../../services/app.route-send.service';
import { AppRouteService } from '../../../services/app.route.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppUserService, GarminRouteSendContext } from '../../../services/app.user.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { LoggerService } from '../../../services/logger.service';
import { normalizeRouteName } from '../../../helpers/route-name.helper';
import {
  canSendRouteToConnectedGarminAccount,
  canSendRouteToConnectedSuuntoAccounts,
  getGarminRouteSendMenuLabel,
  getGarminRouteSendDisabledReason,
  getRouteServiceDisplayName,
  getRouteSourceSummaryLabel,
  getRouteSyncedDestinationLabels,
} from '../../../helpers/route-provenance.helper';
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
import { SHOW_GARMIN_ROUTE_SEND } from '../../../constants/route-delivery.constants';

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
  private originalFileDownloadService = inject(AppOriginalFileDownloadService);
  private analyticsService = inject(AppAnalyticsService);
  private routeGPXExportService = inject(AppRouteGPXExportService);
  private routeReprocessService = inject(AppRouteReprocessService);
  private routeSendService = inject(AppRouteSendService);
  private processingService = inject(AppProcessingService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private userService = inject(AppUserService);
  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private themeService = inject(AppThemeService);

  readonly routeDocument = signal<FirestoreRouteJSON | null>(null);
  readonly routeFile = signal<RouteFileInterface | null>(null);
  readonly sourceFile = signal<OriginalRouteFileMetaData | null>(null);
  readonly user = signal<User | null>(null);
  readonly selectedSegmentIDs = signal<string[]>([]);
  readonly renaming = signal(false);
  readonly downloading = signal(false);
  readonly exportingGPX = signal(false);
  readonly deleting = signal(false);
  readonly reprocessing = signal(false);
  readonly sendingToService = signal(false);
  readonly connectedSuuntoProviderUserIds = signal<string[]>([]);
  readonly garminRouteSendContext = signal<GarminRouteSendContext>({
    connected: false,
    reconnectRequired: false,
    missingPermissions: [],
    providerUserId: null,
    providerStates: [],
    serviceMeta: null,
  });

  readonly unitSettings = this.userSettingsQuery.unitSettings;
  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly suuntoConnectionView = signal<SuuntoServiceConnectionViewModel>(buildSuuntoServiceConnectionViewModel({
    hasToken: false,
    serviceMeta: null,
  }));
  readonly routeName = computed(() => this.routeDocument()?.name || this.routeFile()?.name || 'Untitled route');
  readonly routeDate = computed(() => this.resolveRouteDate());
  readonly sourceFilename = computed(() => this.getSourceFilename());
  readonly sourceFileType = computed(() => this.getPrimaryRouteFileType(this.routeDocument()));
  readonly sourceSummaryLabel = computed(() => getRouteSourceSummaryLabel(this.routeDocument()));
  readonly syncedDestinationLabels = computed(() => getRouteSyncedDestinationLabels(this.routeDocument()));
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
  readonly hasMultipleSegments = computed(() => this.segments().length > 1);
  readonly singleSegment = computed<RouteSegmentDetailView | null>(() => {
    const segments = this.segments();
    return segments.length === 1 ? segments[0] : null;
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
    return buildRouteSummaryMetrics(routeDocument, this.unitSettings());
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
  readonly canSendRoutesToSuunto = computed(() => {
    const connectionView = this.suuntoConnectionView();
    return this.userService.hasProAccessSignal()
      && connectionView.connected
      && !connectionView.reconnectRequired;
  });
  readonly canSendRoutesToGarmin = computed(() => {
    const connectionView = this.garminRouteSendContext();
    return this.userService.hasProAccessSignal()
      && connectionView.connected
      && !connectionView.reconnectRequired
      && connectionView.missingPermissions.length === 0;
  });
  readonly showGarminRouteSend = SHOW_GARMIN_ROUTE_SEND;
  readonly canSendRouteToSuunto = computed(() => {
    const routeDocument = this.routeDocument();
    return !!routeDocument
      && this.canManageRoute()
      && this.routeService.getOriginalRouteFiles(routeDocument).length > 0
      && canSendRouteToConnectedSuuntoAccounts(routeDocument, this.connectedSuuntoProviderUserIds());
  });
  readonly canSendRouteToGarmin = computed(() => {
    const routeDocument = this.routeDocument();
    return !!routeDocument
      && this.canManageRoute()
      && this.routeService.getOriginalRouteFiles(routeDocument).length > 0
      && canSendRouteToConnectedGarminAccount(routeDocument, this.garminRouteSendContext());
  });
  readonly garminRouteSendDisabledReason = computed(() => {
    const routeDocument = this.routeDocument();
    if (!routeDocument || !this.canManageRoute() || this.routeService.getOriginalRouteFiles(routeDocument).length === 0) {
      return null;
    }

    return getGarminRouteSendDisabledReason(routeDocument, this.garminRouteSendContext());
  });
  readonly garminRouteSendMenuLabel = computed(() => {
    return getGarminRouteSendMenuLabel(this.garminRouteSendDisabledReason());
  });
  readonly hasSendableRouteDestination = computed(() => (
    this.canSendRouteToSuunto() || (
      this.showGarminRouteSend && (this.canSendRouteToGarmin() || !!this.garminRouteSendDisabledReason())
    )
  ));
  readonly canReprocessRoute = computed(() => {
    const routeDocument = this.routeDocument();
    return !!routeDocument
      && this.canManageRoute()
      && this.routeService.getOriginalRouteFiles(routeDocument).length > 0;
  });

  constructor() {
    this.activatedRoute.data
      .pipe(takeUntilDestroyed())
      .subscribe((data) => this.applyResolvedRouteData(data['route'] as RouteResolverData | null));

    this.activatedRoute.data
      .pipe(
        map(data => (data['route'] as RouteResolverData | null)?.user ?? null),
        switchMap(user => this.userService.watchSuuntoRouteCatchUpPromptContext(user)),
        takeUntilDestroyed(),
      )
      .subscribe(context => {
        this.suuntoConnectionView.set(context.connectionView);
        this.connectedSuuntoProviderUserIds.set(context.connectedProviderUserIds);
      });

    this.activatedRoute.data
      .pipe(
        map(data => (data['route'] as RouteResolverData | null)?.user ?? null),
        switchMap(user => this.userService.watchGarminRouteSendContext(user)),
        takeUntilDestroyed(),
      )
      .subscribe(context => {
        this.garminRouteSendContext.set(context);
      });
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
    if (
      !routeDocument
      || !routeID
      || !user
      || this.renaming()
      || this.downloading()
      || this.exportingGPX()
      || this.sendingToService()
      || this.reprocessing()
      || this.deleting()
      || !this.canManageRoute()
    ) {
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
    if (
      !routeDocument?.id
      || this.downloading()
      || this.renaming()
      || this.exportingGPX()
      || this.sendingToService()
      || this.reprocessing()
      || this.deleting()
      || !this.canManageRoute()
    ) {
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
      const result = await this.originalFileDownloadService.downloadOriginalFiles({
        sources: originalFiles.map(file => ({
          ...file,
          fallbackDate: this.routeDate(),
        })),
        downloadFile: (path) => this.routeService.downloadOriginalFile(path),
        zipSuffix: 'route_originals',
        fallbackFileName: 'original-route-file',
      });
      this.analyticsService.logSavedRouteAction('download', {
        status: 'success',
        fileCount: result.downloadedCount,
        fileType: this.getPrimaryRouteFileType(routeDocument),
        zipped: result.mode === 'zip',
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

  async exportRouteAsGPX(): Promise<void> {
    const routeDocument = this.routeDocument();
    const routeFile = this.routeFile();
    if (
      !routeDocument?.id
      || !routeFile
      || this.exportingGPX()
      || this.renaming()
      || this.downloading()
      || this.sendingToService()
      || this.reprocessing()
      || this.deleting()
      || !this.canManageRoute()
    ) {
      return;
    }

    this.exportingGPX.set(true);
    this.snackBar.open('Generating route GPX...', undefined, { duration: 2000 });
    try {
      const blob = await this.routeGPXExportService.getRouteFileAsGPXBlob(routeFile);
      const baseName = this.sanitizeFilenameBase(routeDocument.name || routeDocument.id || 'route');
      this.fileService.downloadFile(blob, baseName, 'gpx');
      this.analyticsService.logSavedRouteAction('export_gpx', {
        status: 'success',
        fileCount: 1,
        fileType: 'gpx',
        zipped: false,
        source: 'route_detail',
      });
      this.snackBar.open('GPX file served.', undefined, { duration: 2000 });
    } catch (error) {
      this.analyticsService.logSavedRouteAction('export_gpx', {
        status: 'failure',
        fileCount: 0,
        fileType: this.getPrimaryRouteFileType(routeDocument),
        zipped: false,
        source: 'route_detail',
      });
      this.logger.error('[RouteDetailComponent] Failed to export route GPX', { routeID: routeDocument.id }, error);
      this.snackBar.open('Could not export route GPX.', undefined, { duration: 3000 });
    } finally {
      this.exportingGPX.set(false);
    }
  }

  getRouteSendDestinationLabel(destinationServiceName: ServiceNames): string {
    return getRouteServiceDisplayName(destinationServiceName);
  }

  async sendRouteToSuunto(): Promise<void> {
    await this.sendRouteToService(ServiceNames.SuuntoApp);
  }

  async sendRouteToGarmin(): Promise<void> {
    await this.sendRouteToService(ServiceNames.GarminAPI);
  }

  async sendRouteToService(destinationServiceName: ServiceNames): Promise<void> {
    const routeDocument = this.routeDocument();
    const routeID = routeDocument?.id;
    const destinationLabel = this.getRouteSendDestinationLabel(destinationServiceName);
    if (
      !routeDocument
      || !routeID
      || this.sendingToService()
      || this.renaming()
      || this.downloading()
      || this.exportingGPX()
      || this.reprocessing()
      || this.deleting()
      || !this.canSendRoutesToDestination(destinationServiceName)
      || !this.canSendRouteToDestination(destinationServiceName)
    ) {
      return;
    }

    this.sendingToService.set(true);
    this.snackBar.open(`Sending route to ${destinationLabel}...`, undefined, { duration: 2000 });
    try {
      const result = await this.routeSendService.sendRoutesToService([routeID], destinationServiceName);
      const status = result.successCount > 0 ? 'success' : 'failure';
      this.analyticsService.logSavedRouteAction('send_service_route', {
        status,
        routeCount: 1,
        failedCount: result.failureCount,
        skippedCount: result.skippedCount,
        fileType: this.getPrimaryRouteFileType(routeDocument),
        source: 'route_detail',
        destinationService: destinationServiceName,
      });
      this.snackBar.open(
        result.successCount > 0 ? `Route sent to ${destinationLabel}.` : getRouteSendResponseMessage(result),
        undefined,
        { duration: result.successCount > 0 ? 2500 : 3500 },
      );
    } catch (error) {
      this.analyticsService.logSavedRouteAction('send_service_route', {
        status: 'failure',
        routeCount: 1,
        fileType: this.getPrimaryRouteFileType(routeDocument),
        source: 'route_detail',
        destinationService: destinationServiceName,
      });
      this.logger.error('[RouteDetailComponent] Failed to send route to service', {
        routeID,
        destinationServiceName,
      }, error);
      this.snackBar.open(getRouteSendErrorMessage(error, destinationServiceName), undefined, { duration: 4000 });
    } finally {
      this.sendingToService.set(false);
    }
  }

  async reprocessRouteFromOriginalFile(): Promise<void> {
    const routeDocument = this.routeDocument();
    const routeID = routeDocument?.id;
    const user = this.user();
    if (
      !routeDocument
      || !routeID
      || !user
      || this.reprocessing()
      || this.renaming()
      || this.downloading()
      || this.exportingGPX()
      || this.sendingToService()
      || this.deleting()
      || !this.canManageRoute()
    ) {
      return;
    }

    const originalFiles = this.routeService.getOriginalRouteFiles(routeDocument);
    if (originalFiles.length === 0) {
      this.analyticsService.logSavedRouteAction('reprocess', {
        status: 'missing_file',
        fileCount: 0,
        fileType: this.getPrimaryRouteFileType(routeDocument),
      });
      this.snackBar.open('No original route file found.', undefined, { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Reprocess route from original file?',
        message: 'This will reparse the saved route source file and rebuild route statistics, segments, map bounds, and waypoint counts.',
        confirmLabel: 'Reprocess',
        confirmColor: 'primary',
      } as ConfirmationDialogData,
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) {
      return;
    }

    this.reprocessing.set(true);
    this.snackBar.open('Reprocessing route from source file...', undefined, { duration: 2000 });
    const jobId = this.processingService.addJob('process', 'Reprocessing route from source file...');
    this.processingService.updateJob(jobId, { status: 'processing', progress: 5 });

    try {
      const reprocessedRoute = await this.routeReprocessService.reprocessRouteFromOriginalFile(user, routeDocument, {
        onProgress: (progress) => this.updateReprocessJob(jobId, progress),
      });
      this.routeDocument.set(reprocessedRoute.routeDocument);
      this.routeFile.set(reprocessedRoute.routeFile);
      this.sourceFile.set(reprocessedRoute.sourceFile);
      this.selectedSegmentIDs.set(buildRouteSegmentDetailViews(
        reprocessedRoute.routeDocument,
        reprocessedRoute.routeFile,
        this.unitSettings(),
      ).map(segment => segment.id));
      this.processingService.completeJob(jobId, 'Route reprocess completed');
      this.analyticsService.logSavedRouteAction('reprocess', {
        status: 'success',
        fileCount: reprocessedRoute.sourceFilesCount,
        routeCount: reprocessedRoute.routeCount,
        fileType: this.getPrimaryRouteFileType(reprocessedRoute.routeDocument),
      });
      this.snackBar.open('Route reprocessed from source file.', undefined, { duration: 2500 });
    } catch (error) {
      this.processingService.failJob(jobId, 'Route reprocess failed');
      this.analyticsService.logSavedRouteAction('reprocess', {
        status: 'failure',
        fileCount: originalFiles.length,
        fileType: this.getPrimaryRouteFileType(routeDocument),
      });
      this.logger.error('[RouteDetailComponent] Failed to reprocess route', { routeID }, error);
      this.snackBar.open(getRouteReprocessErrorMessage(error), undefined, { duration: 4000 });
    } finally {
      this.reprocessing.set(false);
    }
  }

  async confirmDeleteRoute(): Promise<void> {
    const routeDocument = this.routeDocument();
    const routeID = routeDocument?.id;
    const user = this.user();
    if (
      !routeDocument
      || !routeID
      || !user
      || this.deleting()
      || this.renaming()
      || this.downloading()
      || this.exportingGPX()
      || this.sendingToService()
      || this.reprocessing()
      || !this.canManageRoute()
    ) {
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

  private updateReprocessJob(jobId: string, progress: RouteReprocessProgress): void {
    this.processingService.updateJob(jobId, {
      status: progress.phase === 'done' ? 'completed' : 'processing',
      title: getRouteReprocessProgressTitle(progress.phase),
      progress: progress.progress,
      details: progress.details,
    });
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
    if (!sourceFile) {
      return 'Original route file';
    }

    return this.fileService.resolveOriginalSourceFileName(
      sourceFile,
      sourceFile.extension || this.routeDocument()?.srcFileType || 'route',
      'Original route file',
    );
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

  private canSendRoutesToDestination(destinationServiceName: ServiceNames): boolean {
    switch (destinationServiceName) {
      case ServiceNames.SuuntoApp:
        return this.canSendRoutesToSuunto();
      case ServiceNames.GarminAPI:
        return this.canSendRoutesToGarmin();
      default:
        return false;
    }
  }

  private canSendRouteToDestination(destinationServiceName: ServiceNames): boolean {
    switch (destinationServiceName) {
      case ServiceNames.SuuntoApp:
        return this.canSendRouteToSuunto();
      case ServiceNames.GarminAPI:
        return this.canSendRouteToGarmin();
      default:
        return false;
    }
  }
}
