import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Injectable,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { AppBreakpoints } from '../../constants/breakpoints';
import { AppColors } from '../../services/color/app.colors';
import { AppEventService } from '../../services/app.event.service';
import { Router } from '@angular/router';
import { MatCard } from '@angular/material/card';
import { MatPaginator, MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort } from '@angular/material/sort';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';
import { MatTableDataSource } from '@angular/material/table';
import { SelectionModel } from '@angular/cdk/collections';
import { DatePipe } from '@angular/common';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { EventInterface } from '@sports-alliance/sports-lib';
import { Privacy } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { debounceTime, map } from 'rxjs/operators';
import { firstValueFrom, race, Subject, Subscription } from 'rxjs';
import { rowsAnimation } from '../../animations/animations';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { AppUserService } from '../../services/app.user.service';
import { AppUserUtilities } from '../../utils/app.user.utilities';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DataDeviceNames } from '@sports-alliance/sports-lib';
import { DataTableAbstractDirective, StatRowElement } from '../data-table/data-table-abstract.directive';
import { EventsExportFormComponent } from '../events-export-form/events-export.form.component';
import { MatDialog } from '@angular/material/dialog';
import { OrderByDirection } from 'firebase/firestore';
import { AppFileService } from '../../services/app.file.service';
import { LoggerService } from '../../services/logger.service';
import { AppOriginalFileDownloadService } from '../../services/app.original-file-download.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppEventUtilities } from '../../utils/app.event.utilities';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
import { MergeOptionsDialogComponent } from './merge-options-dialog/merge-options-dialog.component';
import { AppEventMergeService, MergeEventResponse, MergeType } from '../../services/app.event-merge.service';
import { EventTagService } from '../../services/event-tag.service';
import { EVENT_TAG_BULK_LIMIT, getEventTags, normalizeEventTagSuggestions } from '@shared/event-tags';
import { EventTagsDialogComponent } from '../event-tags/event-tags-dialog.component';
import { EventTagsBulkDialogComponent } from '../event-tags/event-tags-bulk-dialog.component';

interface EventTableRowCacheEntry {
  event: EventInterface;
  eventRowContentKey: string;
  renderContextKey: string;
  row: StatRowElement;
}

interface DeviceNameDisplayItem {
  label: string;
  color: string;
  trackKey: string;
}

@Component({
  selector: 'app-event-table',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.scss'],
  animations: [
    rowsAnimation
  ],
  providers: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventTableComponent extends DataTableAbstractDirective implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() user!: User;
  @Input() events!: EventInterface[];
  @Input() targetUser!: User;
  @Input() showActions!: boolean;
  @ViewChild(MatSort, { static: true }) sort!: MatSort;
  @ViewChild(MatPaginator, { static: true }) paginator!: MatPaginator;
  @ViewChild(MatCard, { static: true }) table!: MatCard;

  data: MatTableDataSource<any> = new MatTableDataSource<StatRowElement>();
  selection = new SelectionModel(true, []);

  selectedColumns = AppUserUtilities.getDefaultSelectedTableColumns();
  displayedColumns: string[] = [];

  public show = true

  private deleteConfirmationSubscription!: Subscription;
  private searchSubscription!: Subscription;
  private sortSubscription!: Subscription;
  private breakpointSubscription!: Subscription;
  private isHandset = false;
  private readonly defaultSelectedColumns = AppUserUtilities.getDefaultSelectedTableColumns();
  private readonly nonSearchableRowKeys = new Set([
    'Color',
    'Gradient',
    'Event',
    'Device Name Items',
    'Shared Title',
    'Tag Values',
    'Tags Title',
    'Tag Action Label',
    'Tags Accessible Label',
  ]);
  private readonly duplicateSourceFilesMessage = 'Selected events include identical source files. Deselect duplicates and try again.';
  readonly sharedEventTooltip = 'Public link enabled. Anyone with the link can view this event, comparison data, and original files.';
  private rowCache = new Map<string, EventTableRowCacheEntry>();


  private searchSubject: Subject<string> = new Subject();
  private analyticsService = inject(AppAnalyticsService);
  private eventTagService = inject(EventTagService);
  public tagFilter = '';
  public tagFilterOptions: string[] = [];
  public isBulkTagSaving = false;

  constructor(private snackBar: MatSnackBar,
    private eventService: AppEventService,
    private eventMergeService: AppEventMergeService,
    private userService: AppUserService,
    changeDetector: ChangeDetectorRef,
    private eventColorService: AppEventColorService,
    private dialog: MatDialog,
    private fileService: AppFileService,
    private router: Router, private datePipe: DatePipe,
    private logger: LoggerService,
    private originalFileDownloadService: AppOriginalFileDownloadService,
    private processingService: AppProcessingService,
    private breakpointObserver: BreakpointObserver,
    private benchmarkFlow: AppBenchmarkFlowService) {
    super(changeDetector);
  }


  ngOnChanges(simpleChanges: SimpleChanges): void {
    this.isLoading ? this.loading() : this.loaded();
    if (!this.events) {
      this.rowCache.clear();
      this.loading();
      return;
    }
    if (this.events && simpleChanges.events && this.data.paginator && this.data.sort) { // If there is no paginator and sort then the compoenent is not initialized on view
      this.processChanges('on_changes_events');
    }
    if (this.user && simpleChanges.user) {
      this.selectedColumns = this.user.settings?.dashboardSettings?.tableSettings?.selectedColumns || AppUserUtilities.getDefaultSelectedTableColumns();
      const nextPageSize = this.user.settings?.dashboardSettings?.tableSettings?.eventsPerPage || 10;
      if (this.paginator && this.paginator.pageSize !== nextPageSize) {
        this.paginator._changePageSize(nextPageSize);
      }
      this.updateDisplayedColumns();
    }
    if (simpleChanges.showActions) {
      this.updateDisplayedColumns();
    }
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error(`Component needs user`)
    }
    this.updateDisplayedColumns();
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(250)
    ).subscribe(searchTextValue => {
      this.search(searchTextValue);
    });

    this.breakpointSubscription = this.breakpointObserver
      .observe([AppBreakpoints.HandsetOrTabletPortrait])
      .subscribe(result => {
        const nextIsHandset = result.matches;
        if (nextIsHandset === this.isHandset) {
          return;
        }
        this.isHandset = nextIsHandset;
        this.updateDisplayedColumns();
        if (this.events && this.data.paginator && this.data.sort) {
          this.processChanges('breakpoint_change');
        }
        this.changeDetector.markForCheck();
      });
  }

  ngAfterViewInit() {
    this.data.paginator = this.paginator;
    this.data.sort = this.sort;
    this.data.sortingDataAccessor = (statRowElement: StatRowElement, header) => {
      return (statRowElement as any)[`sort.${header}`];
    };
    this.data.filterPredicate = (row: any, filter: string) => {
      const filterState = this.parseTableFilter(filter);
      if (filterState.tag) {
        const tagKey = filterState.tag.toLowerCase();
        const rowTags = Array.isArray(row['Tag Values']) ? row['Tag Values'] : [];
        if (!rowTags.some((tag: string) => tag.toLowerCase() === tagKey)) {
          return false;
        }
      }

      const terms = filterState.text
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0);

      if (terms.length === 0) {
        return true;
      }

      const rowText = Object.entries(row)
        .filter(([key, value]) => !key.startsWith('sort.') && !this.nonSearchableRowKeys.has(key) && value != null && typeof value !== 'object')
        .map(([, value]) => String(value).toLowerCase())
        .join(' ');

      return terms.some(term => rowText.includes(term));
    };
    this.sortSubscription = this.sort.sortChange.subscribe(async (sort) => {
      const tableSettings = this.user?.settings?.dashboardSettings?.tableSettings;
      if (!tableSettings) {
        return;
      }
      if (tableSettings.active !== sort.active || tableSettings.direction !== sort.direction) {
        tableSettings.active = sort.active;
        tableSettings.direction = sort.direction as OrderByDirection;
        await this.persistDashboardSettings({
          tableSettings: {
            active: tableSettings.active,
            direction: tableSettings.direction,
          },
        });
      }
    });
    if (this.events) {
      this.processChanges('after_view_init');
    }
  }

  checkBoxClick(row) {
    this.selection.toggle(row);
  }

  clearSelection(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.selection.clear();
  }

  private persistDashboardSettings(dashboardSettingsPatch: Record<string, unknown>): Promise<void> {
    const dashboardSettings = this.user?.settings?.dashboardSettings;
    if (!dashboardSettings) {
      return Promise.resolve();
    }

    return this.userService.updateUserProperties(this.user, {
      settings: { dashboardSettings: dashboardSettingsPatch },
    });
  }

  /**
   * Opens the benchmark report or selection dialog for a merged event directly from the table.
   * Stops propagation to prevent row navigation.
   */
  openBenchmarkFlow(event: Event, appEvent: AppEventInterface): void {
    event.stopPropagation();
    event.preventDefault();

    const initialSelection = appEvent.getActivities().slice(0, 2);
    const result = this.getFirstBenchmarkResult(appEvent);

    if (result) {
      this.benchmarkFlow.openBenchmarkReport({
        event: appEvent,
        persistEvent: appEvent,
        user: this.user,
        result,
        initialSelection
      });
    } else {
      this.benchmarkFlow.openBenchmarkSelectionDialog({
        event: appEvent,
        persistEvent: appEvent,
        user: this.user,
        initialSelection
      });
    }
  }

  getBenchmarkColor(appEvent: AppEventInterface): string {
    const result = this.getFirstBenchmarkResult(appEvent);
    if (!result) return '';

    // Replicating grading logic from BenchmarkReportComponent

    // 1. GNSS Grade
    let gnssScore = 0; // poor
    const cep50 = result.metrics.gnss.cep50;
    if (cep50 <= 2) gnssScore = 3; // excellent
    else if (cep50 <= 5) gnssScore = 2; // good
    else if (cep50 <= 10) gnssScore = 1; // fair

    // 2. Stream Grades
    const streamScores: number[] = [];
    Object.values(result.metrics.streamMetrics).forEach(m => {
      const corr = m.pearsonCorrelation;
      if (corr >= 0.98) streamScores.push(3);
      else if (corr >= 0.95) streamScores.push(2);
      else if (corr >= 0.90) streamScores.push(1);
      else streamScores.push(0);
    });

    const allScores = [gnssScore, ...streamScores];
    if (allScores.length === 0) return AppColors.Orange; // Fair default

    const total = allScores.reduce((a, b) => a + b, 0);
    const avg = total / allScores.length;

    if (avg >= 2.5) return AppColors.Green; // Excellent
    if (avg >= 1.5) return AppColors.Green; // Good (using same green for simplicity or could use a lighter one)
    if (avg >= 0.5) return AppColors.Orange; // Fair
    return AppColors.Red; // Poor
  }

  private getFirstBenchmarkResult(appEvent: AppEventInterface): BenchmarkResult | null {
    const results = appEvent.benchmarkResults;
    if (results) {
      const keys = Object.keys(results);
      if (keys.length > 0) {
        return results[keys[0]];
      }
    }

    const legacy = (appEvent as { benchmarkResult?: BenchmarkResult }).benchmarkResult;
    return legacy ?? null;
  }

  /** Whether the number of selected elements matches the total number of rows. */
  /**
   * Helper to handle cell clicks safely for strict templates
   */
  public onCellClick(event: Event, row: any, column: string): void {
    if (column === 'Checkbox') {
      event.preventDefault();
      event.stopPropagation();
      this.checkBoxClick(row);
    }
  }

  trackByEventId = (index: number, row: StatRowElement): string | number => {
    const event = row?.Event as EventInterface | undefined;
    return event?.getID ? event.getID() : index;
  }

  private getSelectableRows(): any[] {
    return Array.isArray(this.data.filteredData) ? this.data.filteredData : this.data.data;
  }

  isAllSelected() {
    const selectableRows = this.getSelectableRows();
    if (selectableRows.length === 0) {
      return false;
    }
    return selectableRows.every(row => this.selection.isSelected(row));
  }


  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle() {
    const selectableRows = this.getSelectableRows();
    if (this.isAllSelected()) {
      selectableRows.forEach(row => this.selection.deselect(row));
      return;
    }
    selectableRows.forEach(row => this.selection.select(row));
  }

  private collectSourceFilePaths(event: EventInterface): string[] {
    const appEvent = event as {
      originalFiles?: Array<{ path?: unknown }>;
      originalFile?: { path?: unknown };
    };

    if (Array.isArray(appEvent.originalFiles) && appEvent.originalFiles.length > 0) {
      return appEvent.originalFiles
        .map((file) => `${file?.path || ''}`.trim())
        .filter((path) => path.length > 0);
    }

    const legacyPath = `${appEvent.originalFile?.path || ''}`.trim();
    return legacyPath.length > 0 ? [legacyPath] : [];
  }

  private hasDuplicateSourceFilePaths(events: EventInterface[]): boolean {
    const seenPaths = new Set<string>();

    for (const appEvent of events) {
      const sourcePaths = this.collectSourceFilePaths(appEvent);
      for (const path of sourcePaths) {
        if (seenPaths.has(path)) {
          return true;
        }
        seenPaths.add(path);
      }
    }

    return false;
  }

  async mergeSelection(event) {
    if (this.selection.selected.length < 2) {
      this.snackBar.open('Select at least two events to merge', undefined, { duration: 2000 });
      return;
    }

    const selectedEvents = this.selection.selected
      .map((selected) => selected?.Event as EventInterface | undefined)
      .filter((selectedEvent): selectedEvent is EventInterface => !!selectedEvent);

    if (this.hasDuplicateSourceFilePaths(selectedEvents)) {
      this.snackBar.open(this.duplicateSourceFilesMessage, undefined, { duration: 4000 });
      return;
    }

    const dialogRef = this.dialog.open(MergeOptionsDialogComponent);
    const mergeSelection = await firstValueFrom(
      race(
        dialogRef.componentInstance.mergeRequested.pipe(map((option) => option)),
        dialogRef.afterClosed().pipe(map(() => null))
      )
    ).catch(() => null);
    if (!mergeSelection) {
      return;
    }
    dialogRef.disableClose = true;
    dialogRef.componentInstance.isMerging = true;
    const mergeType = mergeSelection as MergeType;

    // Show loading
    this.loading();
    // Remove all subscriptions
    this.unsubscribeFromAll();

    const eventIDs = this.selection.selected
      .map((selected) => selected?.Event?.getID?.())
      .filter((eventID): eventID is string => !!eventID);

    // Now we can clear the selection
    this.selection.clear();

    if (eventIDs.length < 2) {
      this.loaded();
      this.snackBar.open('Not enough events to merge', undefined, { duration: 3000 });
      dialogRef.disableClose = false;
      dialogRef.componentInstance.isMerging = false;
      return;
    }

    let result: MergeEventResponse;
    try {
      result = await this.eventMergeService.mergeEvents(eventIDs, mergeType);
    } catch (error) {
      this.logger.captureException(error, {
        extra: {
          eventIDs,
          mergeType,
        }
      });
      this.loaded();
      this.snackBar.open(this.eventMergeService.getMergeErrorMessage(error), undefined, {
        duration: 5000,
      });
      dialogRef.disableClose = false;
      dialogRef.componentInstance.isMerging = false;
      return;
    }

    try {
      this.analyticsService.logEvent('merge_events');
    } catch (error) {
      this.logger.warn('Failed to log merge event analytics.', error);
    }

    dialogRef.close(true);

    try {
      const navigated = await this.router.navigate(['/user', this.user.uid, 'event', result.eventId], {});
      if (navigated) {
        this.snackBar.open('Events merged', undefined, {
          duration: 2000,
        });
        return;
      }
    } catch (error) {
      this.logger.captureException(error, {
        extra: {
          eventIDs,
          mergeType,
          mergedEventID: result.eventId,
          stage: 'open_merged_event',
        }
      });
    }

    this.loaded();
    this.snackBar.open('Events merged. Open the merged event from the table once it appears.', undefined, {
      duration: 5000,
    });
  }

  async deleteSelection() {
    this.loading();
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Are you sure you want to delete?',
        message: 'All data will be permanently deleted. This operation cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      }
    });
    this.deleteConfirmationSubscription = dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) {
        this.loaded();
        return;
      }
      this.unsubscribeFromAll();
      const deletePromises = [];
      const eventsToDelete = this.selection.selected.map(selected => selected.Event);
      eventsToDelete.forEach((event) => deletePromises.push(this.eventService.deleteAllEventData(this.user, event.getID())));
      this.selection.clear();
      await Promise.all(deletePromises);

      // Update local view
      if (this.events) {
        const deletedIds = new Set(eventsToDelete.map(e => e.getID()));
        this.events = this.events.filter(e => !deletedIds.has(e.getID()));
        this.processChanges('after_delete_selection');
      }

      this.analyticsService.logEvent('delete_events');
      this.snackBar.open('Events deleted', undefined, {
        duration: 2000,
      });
      this.loaded();
    });
  }

  public downloadAsCSV(event) {
    this.dialog.open(EventsExportFormComponent, {
      // width: '100vw',
      disableClose: false,
      data: {
        events: this.selection.selected.map(selected => selected.Event),
        user: this.user,
      },
    });
  }

  public async downloadGPXSelection() {
    const jobId = this.processingService.addJob('download', 'Preparing GPX export...');

    try {
      const selectedEvents = this.selection.selected.map(selected => selected.Event) as EventInterface[];
      if (selectedEvents.length === 0) {
        this.snackBar.open('No events selected', undefined, { duration: 2000 });
        this.processingService.removeJob(jobId);
        return;
      }

      this.processingService.updateJob(jobId, {
        title: `Generating ${selectedEvents.length} GPX ${selectedEvents.length === 1 ? 'file' : 'files'}...`,
        progress: 10,
      });

      const generatedFiles: { data: Blob, eventDate: Date | null, eventId: string | null }[] = [];
      let minDate: Date | null = null;
      let maxDate: Date | null = null;
      let failedCount = 0;
      let completed = 0;

      for (const event of selectedEvents) {
        const eventDate = this.fileService.toDate(event.startDate);
        const eventId = event.getID ? event.getID() : null;

        try {
          const data = await this.eventService.getEventAsGPXBloB(this.user, event as any);
          generatedFiles.push({ data, eventDate, eventId });
          if (eventDate) {
            if (!minDate || eventDate < minDate) minDate = eventDate;
            if (!maxDate || eventDate > maxDate) maxDate = eventDate;
          }
        } catch (error) {
          failedCount++;
          this.logger.error('Failed to export GPX for selected event:', eventId, error);
        }

        completed++;
        this.processingService.updateJob(jobId, {
          progress: 10 + Math.round((completed / selectedEvents.length) * 70),
          details: `Processed ${completed} of ${selectedEvents.length}`,
        });
      }

      if (generatedFiles.length === 0) {
        this.snackBar.open('Could not export GPX for selected events', undefined, { duration: 3000 });
        this.processingService.failJob(jobId, 'No GPX files exported');
        return;
      }

      const filesToDownload = generatedFiles.map((file, index) => ({
        data: file.data,
        fileName: this.fileService.generateDateBasedFilename(
          file.eventDate,
          'gpx',
          index + 1,
          generatedFiles.length,
          file.eventId,
        ),
      }));

      if (selectedEvents.length === 1) {
        this.processingService.updateJob(jobId, { title: 'Preparing GPX file...', progress: 90 });
        const file = filesToDownload[0];
        const parts = file.fileName.split('.');
        const extension = parts.length > 1 ? (parts.pop() || 'gpx') : 'gpx';
        const baseNameWithoutExt = parts.join('.');
        this.fileService.downloadFile(file.data, baseNameWithoutExt, extension);
      } else {
        this.processingService.updateJob(jobId, { title: 'Zipping GPX files...', progress: 90 });
        const zipFileName = this.fileService.generateDateRangeZipFilename(minDate, maxDate, 'gpx');
        await this.fileService.downloadAsZip(filesToDownload, zipFileName);
      }

      const downloadedCount = generatedFiles.length;
      this.processingService.completeJob(
        jobId,
        `Downloaded ${downloadedCount} GPX ${downloadedCount === 1 ? 'file' : 'files'}`,
      );
      this.analyticsService.logEvent('downloaded_gpx_file', {
        count: downloadedCount,
        skipped: failedCount,
        source: 'event_table_selection',
      });

      if (failedCount > 0) {
        this.snackBar.open(
          `Downloaded ${downloadedCount} GPX ${downloadedCount === 1 ? 'file' : 'files'}. Skipped ${failedCount} ${failedCount === 1 ? 'event' : 'events'}.`,
          undefined,
          { duration: 4000 },
        );
        return;
      }

      this.snackBar.open(selectedEvents.length === 1 ? 'GPX file served' : 'GPX files served', undefined, {
        duration: 2000,
      });
    } catch (error) {
      this.logger.error('Error exporting GPX files:', error);
      this.processingService.failJob(jobId, 'GPX export failed');
      this.snackBar.open('Error exporting GPX files', undefined, { duration: 3000 });
    }
  }

  public async downloadOriginals() {
    // Start background job instead of blocking UI
    const jobId = this.processingService.addJob('download', 'Preparing download...');

    try {
      const selectedEvents = this.selection.selected.map(s => s.Event) as EventInterface[];
      if (selectedEvents.length === 0) {
        this.snackBar.open('No events selected', undefined, { duration: 2000 });
        this.processingService.removeJob(jobId);
        return;
      }

      // Collect all file metadata from selected events
      const filesToDownload: Array<{ path: string; startDate?: unknown; fallbackDate?: unknown; originalFilename?: string; downloadFileName?: string; extension?: string; eventId: string | null }> = [];

      this.processingService.updateJob(jobId, { title: 'Gathering file info...', progress: 10 });

      for (const event of selectedEvents) {
        const originalFiles = this.eventService.getOriginalEventDownloadSources(event as any);
        for (const fileMeta of originalFiles) {
          filesToDownload.push(fileMeta);
        }
      }

      if (filesToDownload.length === 0) {
        this.snackBar.open('No original files available for selected events', undefined, { duration: 3000 });
        this.processingService.removeJob(jobId);
        return;
      }

      // Download all files
      this.processingService.updateJob(jobId, { title: `Downloading ${filesToDownload.length} files...`, progress: 20 });

      const result = await this.originalFileDownloadService.downloadOriginalFiles({
        sources: filesToDownload,
        downloadFile: (path) => this.eventService.downloadOriginalFile(path),
        fallbackFileName: 'original-file',
        continueOnFailure: true,
        onFileFailed: (source, error) => {
          this.logger.error('Failed to download file:', source.path, error);
        },
        onFileProcessed: ({ completed, total, downloadedCount }) => {
          const progress = 20 + Math.round((completed / total) * 60);
          this.processingService.updateJob(jobId, {
            progress,
            details: `Downloaded ${downloadedCount} of ${total}`
          });
        },
      });

      if (result.mode === 'none') {
        this.snackBar.open('Failed to download any files', undefined, { duration: 3000 });
        this.processingService.failJob(jobId, 'No files downloaded');
        return;
      }

      this.processingService.completeJob(jobId, `Downloaded ${result.downloadedCount} file${result.downloadedCount === 1 ? '' : 's'}`);
      this.analyticsService.logEvent('download_originals', {
        count: result.downloadedCount,
        failedCount: result.failedCount,
      });
      if (result.failedCount > 0) {
        this.snackBar.open(
          `Downloaded ${result.downloadedCount} file${result.downloadedCount === 1 ? '' : 's'}. Failed ${result.failedCount}.`,
          undefined,
          { duration: 4000 },
        );
      }
    } catch (e) {
      this.logger.error('Error downloading originals:', e);
      this.processingService.failJob(jobId, 'Download failed');
      this.snackBar.open('Error downloading files', undefined, { duration: 3000 });
    }
  }

  // Todo cache this please
  getColumnsToDisplay() {
    return this.displayedColumns;
  }

  override isColumnHeaderSortable(columnName: string): boolean {
    return columnName === 'Shared' || super.isColumnHeaderSortable(columnName);
  }

  private updateDisplayedColumns() {
    const sortedSelectedColumns = (this.selectedColumns || [])
      .filter(column => column !== 'Description' && column !== 'Shared' && column !== 'Tags')
      .sort((a, b) => this.defaultSelectedColumns.indexOf(a) - this.defaultSelectedColumns.indexOf(b));

    const activityTypeColumn = sortedSelectedColumns.find(column => column === 'Activity Types');
    const remainingSelectedColumns = activityTypeColumn
      ? sortedSelectedColumns.filter(column => column !== activityTypeColumn)
      : sortedSelectedColumns;
    const dataColumns = this.isHandset
      ? [...(activityTypeColumn ? [activityTypeColumn] : []), 'Tags', ...remainingSelectedColumns]
      : [...sortedSelectedColumns, 'Tags'];

    const columns = [
      'Checkbox',
      'Start Date',
      ...dataColumns,
      'Description',
      'Shared',
      'Actions',
    ];

    this.displayedColumns = this.showActions
      ? columns
      : columns.filter(column => column !== 'Checkbox' && column !== 'Shared' && column !== 'Actions');
  }

  async saveEventDescription(description: string, event: EventInterface) {
    event.description = description;
    this.invalidateRowCacheForEvent(event);
    await this.eventService.updateEventProperties(this.user, event.getID(), {
      description: event.description,
    });
    this.snackBar.open('Event saved', undefined, {
      duration: 2000,
    });
  }

  async saveEventName(name: string, event: EventInterface) {
    event.name = name;
    this.invalidateRowCacheForEvent(event);
    await this.eventService.updateEventProperties(this.user, event.getID(), {
      name: event.name,
    });
    this.snackBar.open('Event saved', undefined, {
      duration: 2000,
    });
  }

  // Noop due to bugs
  async pageChanges(pageEvent: PageEvent) {
    // @important This is nasty because it's called if anything almost changes
    if (this.user.settings?.dashboardSettings?.tableSettings) {
      if (this.user.settings.dashboardSettings.tableSettings.eventsPerPage === pageEvent.pageSize) {
        return;
      }
      this.user.settings.dashboardSettings.tableSettings.eventsPerPage = pageEvent.pageSize;
      return this.persistDashboardSettings({
        tableSettings: {
          eventsPerPage: pageEvent.pageSize,
        },
      });
    }
  }

  searchTerm: string = '';

  search(searchTerm: string) {
    this.searchTerm = searchTerm;
    this.applyTableFilter();
  }

  updateTagFilter(tag: string): void {
    const requestedTag = `${tag || ''}`;
    this.tagFilter = requestedTag
      ? this.tagFilterOptions.find(option => option.toLowerCase() === requestedTag.toLowerCase()) || ''
      : '';
    this.applyTableFilter();
  }

  async openEventTagsDialog(domEvent: Event, event: AppEventInterface): Promise<void> {
    domEvent.preventDefault();
    domEvent.stopPropagation();
    if (!this.showActions || !this.user || !event?.getID?.()) {
      return;
    }
    const originalTags = this.eventTagService.getTags(event);

    const dialogRef = this.dialog.open(EventTagsDialogComponent, {
      width: 'min(34rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        title: 'Event tags',
        tags: originalTags,
        suggestions: this.tagFilterOptions,
        save: async (tags: string[]) => {
          const savedTags = await this.eventTagService.saveTags(this.user, event, tags, originalTags);
          this.applySavedTagsToLoadedEvent(event.getID(), savedTags, event);
          return savedTags;
        },
      },
    });
    const savedTags = await firstValueFrom(dialogRef.afterClosed());
    if (!Array.isArray(savedTags)) {
      return;
    }

    this.processChanges('event_tags_saved');
    this.snackBar.open('Tags saved.', undefined, { duration: 2000 });
  }

  async openBulkEventTagsDialog(domEvent: Event): Promise<void> {
    domEvent.preventDefault();
    domEvent.stopPropagation();
    if (this.isBulkTagSaving || !this.user || !this.selection.selected.length) {
      return;
    }
    if (this.selection.selected.length > EVENT_TAG_BULK_LIMIT) {
      this.snackBar.open(
        `Select up to ${EVENT_TAG_BULK_LIMIT} events to update tags.`,
        undefined,
        { duration: 3000 },
      );
      return;
    }

    const selectedEvents = this.selection.selected
      .map(row => row?.Event as AppEventInterface | undefined)
      .filter((event): event is AppEventInterface => !!event?.getID?.());
    const selectedEventIDs = selectedEvents.map(event => event.getID());
    if (!selectedEventIDs.length) {
      this.snackBar.open('Select at least one valid event to update tags.', undefined, { duration: 2500 });
      return;
    }
    const removeSuggestions = normalizeEventTagSuggestions(selectedEvents.flatMap(event => getEventTags(event)));
    let savedResults: Record<string, string[]> | null = null;

    const dialogRef = this.dialog.open(EventTagsBulkDialogComponent, {
      width: 'min(38rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        selectedCount: selectedEvents.length,
        addSuggestions: this.tagFilterOptions,
        removeSuggestions,
        save: async (changes: { add: string[]; remove: string[] }) => {
          this.isBulkTagSaving = true;
          try {
            savedResults = await this.eventTagService.applyBulkChanges(this.user, selectedEventIDs, changes);
            selectedEvents.forEach((event) => {
              const eventID = event.getID();
              this.applySavedTagsToLoadedEvent(eventID, savedResults?.[eventID] || getEventTags(event), event);
            });
            return savedResults;
          } finally {
            this.isBulkTagSaving = false;
          }
        },
      },
    });

    const didSave = await firstValueFrom(dialogRef.afterClosed());
    if (!didSave || !savedResults) {
      return;
    }
    this.processChanges('bulk_event_tags_saved');
    this.snackBar.open(
      `Tags updated on ${selectedEvents.length} ${selectedEvents.length === 1 ? 'event' : 'events'}.`,
      undefined,
      { duration: 2500 },
    );
  }

  private applySavedTagsToLoadedEvent(
    eventID: string,
    tags: string[],
    fallbackEvent: AppEventInterface,
  ): void {
    fallbackEvent.tags = tags;
    delete fallbackEvent.benchmarkReviewTags;
    const loadedEvent = this.events.find(event => event.getID() === eventID) as AppEventInterface | undefined;
    if (loadedEvent && loadedEvent !== fallbackEvent) {
      loadedEvent.tags = tags;
      delete loadedEvent.benchmarkReviewTags;
    }
    this.invalidateRowCacheForEvent(loadedEvent || fallbackEvent);
  }

  onSearchInput(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchTerm = filterValue;
    this.searchSubject.next(filterValue);
  }

  clearSearch() {
    this.searchTerm = '';
    this.search('');
  }

  private applyTableFilter(): void {
    this.data.filter = JSON.stringify({
      text: this.searchTerm.trim().toLowerCase(),
      tag: this.tagFilter,
    });
  }

  private parseTableFilter(filter: string): { text: string; tag: string } {
    try {
      const parsed = JSON.parse(filter || '{}') as { text?: unknown; tag?: unknown };
      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        tag: typeof parsed.tag === 'string' ? parsed.tag : '',
      };
    } catch {
      return { text: `${filter || ''}`, tag: '' };
    }
  }

  onKeyUp(event: KeyboardEvent) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchSubject.next(filterValue);
  }

  async selectedColumnsChange(event: string[]) {
    this.selectedColumns = event
    this.updateDisplayedColumns();
    this.user.settings.dashboardSettings.tableSettings.selectedColumns = this.selectedColumns
    await this.persistDashboardSettings({
      tableSettings: {
        selectedColumns: this.selectedColumns,
      },
    });
  }

  ngOnDestroy() {
    this.unsubscribeFromAll();
    if (this.breakpointSubscription) {
      this.breakpointSubscription.unsubscribe();
    }
    this.rowCache.clear();
  }

  isSticky(column: string) {
    return false
  }

  isStickyEnd(column: string) {
    return false
  }

  private processChanges(trigger: string = 'unknown') {
    if (!this.events || !this.user) {
      return;
    }
    const processStart = performance.now();
    const dateFormat = this.isHandset ? 'd MMM yy' : 'EEEEEE d MMM yy HH:mm';
    const removedAscentTypes = new Set((this.user.settings.summariesSettings?.removeAscentForEventTypes || []) as ActivityTypes[]);
    const removedDescentTypes = new Set((((this.user.settings.summariesSettings as any)?.removeDescentForEventTypes || [])) as ActivityTypes[]);
    const renderContextKey = this.buildRowRenderContextKey(dateFormat);
    const previousRowCacheSize = this.rowCache.size;
    const nextRowCache = new Map<string, EventTableRowCacheEntry>();
    const rows: StatRowElement[] = [];
    let reusedRows = 0;
    let rebuiltRows = 0;
    let cacheEntriesFound = 0;
    let cacheReferenceMatches = 0;
    let cacheReferenceMismatches = 0;
    let cacheContextMismatches = 0;
    let cacheContentMismatches = 0;

    this.selection.clear();
    for (const event of this.events) {
      if (!event) {
        continue;
      }

      const eventID = this.getEventID(event);
      const cachedEntry = eventID ? this.rowCache.get(eventID) : null;
      const eventRowContentKey = this.buildEventRowContentKey(event);
      if (cachedEntry && eventID) {
        cacheEntriesFound += 1;
        if (cachedEntry.event === event) {
          cacheReferenceMatches += 1;
        } else {
          cacheReferenceMismatches += 1;
        }
        if (cachedEntry.renderContextKey !== renderContextKey) {
          cacheContextMismatches += 1;
        }
        if (cachedEntry.eventRowContentKey !== eventRowContentKey) {
          cacheContentMismatches += 1;
        }
      }
      if (
        cachedEntry &&
        eventID &&
        cachedEntry.event === event &&
        cachedEntry.renderContextKey === renderContextKey &&
        cachedEntry.eventRowContentKey === eventRowContentKey
      ) {
        rows.push(cachedEntry.row);
        nextRowCache.set(eventID, cachedEntry);
        reusedRows += 1;
        continue;
      }

      const statRowElement = this.buildRowElement(
        event,
        dateFormat,
        removedAscentTypes,
        removedDescentTypes,
      );
      rows.push(statRowElement);

      if (eventID) {
        nextRowCache.set(eventID, {
          event,
          eventRowContentKey,
          renderContextKey,
          row: statRowElement,
        });
      }
      rebuiltRows += 1;
    }
    this.rowCache = nextRowCache;
    this.data.data = rows;
    this.tagFilterOptions = normalizeEventTagSuggestions(
      rows.flatMap(row => row['Tag Values'] || []),
    ).sort((first, second) => first.localeCompare(second));
    if (this.tagFilter) {
      const selectedTagKey = this.tagFilter.toLowerCase();
      const matchingTagOption = this.tagFilterOptions.find(tag => tag.toLowerCase() === selectedTagKey) || '';
      if (matchingTagOption !== this.tagFilter) {
        this.tagFilter = matchingTagOption;
        this.applyTableFilter();
      }
    }
    this.logger.info('[perf] event_table_process_changes', {
      durationMs: Number((performance.now() - processStart).toFixed(2)),
      trigger,
      inputEvents: this.events.length,
      outputRows: this.data.data.length,
      reusedRows,
      rebuiltRows,
      previousRowCacheSize,
      cacheEntriesFound,
      cacheReferenceMatches,
      cacheReferenceMismatches,
      cacheContextMismatches,
      cacheContentMismatches,
      isHandset: this.isHandset,
      pageSize: this.paginator?.pageSize || this.user.settings?.dashboardSettings?.tableSettings?.eventsPerPage || 0,
    });
    this.loaded();

  }

  private buildRowElement(
    event: EventInterface,
    dateFormat: string,
    removedAscentTypes: Set<ActivityTypes>,
    removedDescentTypes: Set<ActivityTypes>,
  ): StatRowElement {
    const activityTypesStat = <DataActivityTypes>event.getStat(DataActivityTypes.type);
    const statRowElement = this.getStatsRowElement(
      event.getStatsAsArray(),
      activityTypesStat ? activityTypesStat.getValue() : [ActivityTypes.unknown],
      this.user.settings.unitSettings,
      event.isMerge
    );
    const activityTypes = event.getActivityTypesAsArray();
    const primaryActivityType = activityTypes.length > 1
      ? ActivityTypes.Multisport
      : (ActivityTypes[activityTypes[0] as keyof typeof ActivityTypes] || ActivityTypes.unknown);
    const startDate = event.startDate instanceof Date && !isNaN(+event.startDate)
      ? event.startDate
      : null;

    const isShared = this.isEventPubliclyShared(event);
    statRowElement['Privacy'] = event.privacy;
    statRowElement['Shared'] = isShared ? 'Shared' : '';
    statRowElement['Shared Title'] = isShared ? this.sharedEventTooltip : '';
    statRowElement['Name'] = event.name;
    statRowElement['Start Date'] = startDate ? this.datePipe.transform(startDate, dateFormat) : 'None?';
    statRowElement['Activity Types'] = event.getActivityTypesAsString();
    statRowElement['Merged Event'] = event.isMerge;
    statRowElement['Description'] = event.description;
    const tags = getEventTags(event as AppEventInterface);
    statRowElement['Tags'] = tags.join(' ');
    statRowElement['Tag Values'] = tags;
    statRowElement['Tags Title'] = tags.join('\n');
    const eventLabel = event.name || 'event';
    statRowElement['Tag Action Label'] = `${tags.length ? 'Edit' : 'Add'} event tags for ${eventLabel}`;
    statRowElement['Tags Accessible Label'] = `Event tags for ${eventLabel}: ${tags.join(', ')}`;
    statRowElement['Device Names'] = event.getDeviceNamesAsString();
    statRowElement['Device Name Items'] = this.buildDeviceNameDisplayItems(event);
    statRowElement['Color'] = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(
      primaryActivityType
    );
    statRowElement['Gradient'] = this.eventColorService.getGradientForActivityTypeGroup(
      primaryActivityType
    );
    statRowElement['Event'] = event;

    statRowElement.isAscentExcluded = activityTypes.some(type =>
      AppEventUtilities.shouldExcludeAscent(type as ActivityTypes) ||
      removedAscentTypes.has(type as any)
    );

    statRowElement.isDescentExcluded = activityTypes.some(type =>
      AppEventUtilities.shouldExcludeDescent(type as ActivityTypes) ||
      removedDescentTypes.has(type as any)
    );

    statRowElement['Has Benchmark'] = (event as any).benchmarkResult || ((event as any).benchmarkResults && Object.keys((event as any).benchmarkResults).length > 0);

    statRowElement['sort.Start Date'] = startDate ? startDate.getTime() : 0;
    statRowElement['sort.Activity Types'] = statRowElement['Activity Types'];
    statRowElement['sort.Description'] = statRowElement['Description'];
    statRowElement['sort.Device Names'] = statRowElement['Device Names'];
    statRowElement['sort.Shared'] = isShared ? 1 : 0;

    return statRowElement;
  }

  private isEventPubliclyShared(event: EventInterface): boolean {
    return event?.privacy === Privacy.Public;
  }

  private buildDeviceNameDisplayItems(event: EventInterface): DeviceNameDisplayItem[] {
    const activities = event.getActivities?.() ?? [];
    if (!activities.length) {
      return this.buildDeviceNameDisplayItemsFromNames(this.getDeviceNamesFromStat(event));
    }

    return this.buildDeviceNameDisplayItemsFromActivities(activities);
  }

  private buildDeviceNameDisplayItemsFromActivities(activities: ActivityInterface[]): DeviceNameDisplayItem[] {
    return activities.reduce<DeviceNameDisplayItem[]>((items, activity, index) => {
      const label = this.getDeviceNameLabel(activity);
      if (!label) {
        return items;
      }

      items.push({
        label,
        color: this.getDeviceNameColor(activities, activity),
        trackKey: activity.getID?.() || `${label}-${index}`,
      });
      return items;
    }, []);
  }

  private buildDeviceNameDisplayItemsFromNames(deviceNames: string[]): DeviceNameDisplayItem[] {
    const activities = deviceNames.map((deviceName, index) => ({
      creator: { name: deviceName },
      getID: () => `device-name-${index}`,
      type: '',
    })) as unknown as ActivityInterface[];

    return activities.map((activity, index) => ({
      label: deviceNames[index],
      color: this.getDeviceNameColor(activities, activity),
      trackKey: `device-name-${index}-${deviceNames[index]}`,
    }));
  }

  private getDeviceNamesFromStat(event: EventInterface): string[] {
    const deviceNamesStat = this.safeCallForCacheKey(() => event.getStat(DataDeviceNames.type), null);
    if (!deviceNamesStat || typeof (deviceNamesStat as any).getValue !== 'function') {
      return [];
    }

    const rawDeviceNames = this.safeCallForCacheKey(() => (deviceNamesStat as any).getValue(), []);

    if (!Array.isArray(rawDeviceNames)) {
      return [];
    }

    return rawDeviceNames
      .map((deviceName) => `${deviceName || ''}`.trim())
      .filter((deviceName) => deviceName.length > 0);
  }

  private getDeviceNameLabel(activity: ActivityInterface): string {
    const name = `${activity.creator?.name || ''}`.trim();
    const swInfo = `${activity.creator?.swInfo || ''}`.trim();
    const label = swInfo ? `${name} ${swInfo}` : name;

    return `${label}`.trim() || `${activity.type || ''}`.trim();
  }

  private getDeviceNameColor(activities: ActivityInterface[], activity: ActivityInterface): string {
    try {
      return this.eventColorService.getActivityColor(activities, activity);
    } catch (error) {
      this.logger.warn('[EventTableComponent] Could not resolve device name color', {
        activityID: activity.getID?.() ?? null,
        error,
      });
      return AppColors.Blue;
    }
  }

  private buildRowRenderContextKey(dateFormat: string): string {
    const summariesSettings = this.user?.settings?.summariesSettings as {
      removeAscentForEventTypes?: ActivityTypes[];
      removeDescentForEventTypes?: ActivityTypes[];
    } | undefined;

    return JSON.stringify({
      dateFormat,
      unitSettings: this.user?.settings?.unitSettings ?? null,
      removeAscentForEventTypes: [...(summariesSettings?.removeAscentForEventTypes || [])].sort(),
      removeDescentForEventTypes: [...(summariesSettings?.removeDescentForEventTypes || [])].sort(),
    });
  }

  private buildEventRowContentKey(event: EventInterface): string {
    const stats = this.readStatsForCacheKey(event);
    const benchmarkResults = (event as any).benchmarkResults;
    const startDate = event.startDate instanceof Date && !isNaN(+event.startDate)
      ? event.startDate.getTime()
      : null;

    return JSON.stringify({
      name: event.name ?? null,
      description: event.description ?? null,
      tags: getEventTags(event as AppEventInterface),
      privacy: event.privacy ?? null,
      isMerge: event.isMerge ?? false,
      startDate,
      activityTypesAsString: this.safeCallForCacheKey(() => event.getActivityTypesAsString(), ''),
      activityTypesAsArray: this.safeCallForCacheKey(() => event.getActivityTypesAsArray(), []),
      deviceNamesAsString: this.safeCallForCacheKey(() => event.getDeviceNamesAsString(), ''),
      deviceNamesFromStat: this.getDeviceNamesFromStat(event),
      deviceNameItems: this.readDeviceNameItemsForCacheKey(event),
      benchmarkResult: this.normalizeCacheValue((event as any).benchmarkResult),
      benchmarkResults: this.normalizeCacheValue(benchmarkResults),
      benchmarkResultKeys: benchmarkResults && typeof benchmarkResults === 'object'
        ? Object.keys(benchmarkResults).sort()
        : [],
      stats,
    });
  }

  private readDeviceNameItemsForCacheKey(event: EventInterface): unknown[] {
    const activities = this.safeCallForCacheKey(() => event.getActivities?.() ?? [], []);
    if (!Array.isArray(activities)) {
      return [];
    }

    return activities.map((activity: ActivityInterface, index) => ({
      id: this.safeCallForCacheKey(() => activity.getID?.(), null),
      index,
      creatorName: `${activity.creator?.name || ''}`.trim(),
      creatorSwInfo: `${activity.creator?.swInfo || ''}`.trim(),
      type: activity.type ?? null,
    }));
  }

  private readStatsForCacheKey(event: EventInterface): unknown[] {
    const stats = this.safeCallForCacheKey(() => event.getStatsAsArray(), []);
    if (!Array.isArray(stats)) {
      return [];
    }

    return stats.map((stat: any) => ({
      type: this.safeCallForCacheKey(() => stat?.getType?.(), null),
      value: this.normalizeCacheValue(this.safeCallForCacheKey(() => stat?.getValue?.(), null)),
      displayValue: this.safeCallForCacheKey(() => stat?.getDisplayValue?.(), null),
      displayUnit: this.safeCallForCacheKey(() => stat?.getDisplayUnit?.(), null),
    }));
  }

  private safeCallForCacheKey<T>(read: () => T, fallback: T): T {
    try {
      return read();
    } catch {
      return fallback;
    }
  }

  private normalizeCacheValue(value: any, depth: number = 0, seen?: WeakSet<object>): unknown {
    if (value == null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    if (depth >= 2) {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map(item => this.normalizeCacheValue(item, depth + 1, seen));
    }
    if (typeof value === 'object') {
      const cacheSeen = seen || new WeakSet<object>();
      if (cacheSeen.has(value)) {
        return '[Circular]';
      }
      cacheSeen.add(value);
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        normalized[key] = this.normalizeCacheValue(value[key], depth + 1, cacheSeen);
      }
      return normalized;
    }

    return String(value);
  }

  private getEventID(event: EventInterface | undefined): string | null {
    if (!event) {
      return null;
    }

    const eventWithID = event as EventInterface & { id?: string };
    if (typeof eventWithID.getID === 'function') {
      return eventWithID.getID() || null;
    }

    return eventWithID.id || null;
  }

  private invalidateRowCacheForEvent(event: EventInterface | undefined): void {
    const eventID = this.getEventID(event);
    if (!eventID) {
      return;
    }
    this.rowCache.delete(eventID);
  }

  private unsubscribeFromAll() {
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe();
    }
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
    if (this.sortSubscription) {
      this.sortSubscription.unsubscribe();
    }
  }
}


@Injectable()
export class MatPaginatorIntlFireStore extends MatPaginatorIntl {
  itemsPerPageLabel = 'Items';
  nextPageLabel = 'Next';
  previousPageLabel = 'Previous';
}
