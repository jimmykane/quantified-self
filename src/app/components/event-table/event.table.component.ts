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
import { AppEventInterface, BenchmarkResult } from '../../../../functions/src/shared/app-event.interface';
import { MatTableDataSource } from '@angular/material/table';
import { SelectionModel } from '@angular/cdk/collections';
import { DatePipe } from '@angular/common';
import { EventInterface } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { debounceTime, map } from 'rxjs/operators';
import { firstValueFrom, race, Subject, Subscription } from 'rxjs';
import { rowsAnimation, expandCollapse } from '../../animations/animations';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { AppUserService } from '../../services/app.user.service';
import { AppUserUtilities } from '../../utils/app.user.utilities';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DataTableAbstractDirective, StatRowElement } from '../data-table/data-table-abstract.directive';
import { EventsExportFormComponent } from '../events-export-form/events-export.form.component';
import { MatDialog } from '@angular/material/dialog';
import { OrderByDirection } from 'firebase/firestore';
import { AppFileService } from '../../services/app.file.service';
import { LoggerService } from '../../services/logger.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppEventUtilities } from '../../utils/app.event.utilities';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
import { MergeOptionsDialogComponent } from './merge-options-dialog/merge-options-dialog.component';
import { AppEventMergeService, MergeType } from '../../services/app.event-merge.service';

@Component({
  selector: 'app-event-table',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.scss'],
  animations: [
    rowsAnimation,
    expandCollapse
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
  private sortSubscription!: Subscription;
  private breakpointSubscription!: Subscription;
  private isHandset = false;
  private readonly defaultSelectedColumns = AppUserUtilities.getDefaultSelectedTableColumns();


  private searchSubject: Subject<string> = new Subject();
  private analyticsService = inject(AppAnalyticsService);

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
    private processingService: AppProcessingService,
    private breakpointObserver: BreakpointObserver,
    private benchmarkFlow: AppBenchmarkFlowService) {
    super(changeDetector);
  }


  ngOnChanges(simpleChanges: SimpleChanges): void {
    this.isLoading ? this.loading() : this.loaded();
    if (!this.events) {
      this.loading();
      return;
    }
    if (this.events && simpleChanges.events && this.data.paginator && this.data.sort) { // If there is no paginator and sort then the compoenent is not initialized on view
      this.processChanges('on_changes_events');
    }
    if (this.user && simpleChanges.user) {
      this.selectedColumns = this.user.settings?.dashboardSettings?.tableSettings?.selectedColumns || AppUserUtilities.getDefaultSelectedTableColumns();
      this.paginator?._changePageSize(this.user.settings?.dashboardSettings?.tableSettings?.eventsPerPage || 10);
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
    this.searchSubject.pipe(
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
    this.sortSubscription = this.sort.sortChange.subscribe(async (sort) => {
      if (this.user.settings.dashboardSettings.tableSettings.active !== sort.active || this.user.settings.dashboardSettings.tableSettings.direction !== sort.direction) {
        this.user.settings.dashboardSettings.tableSettings.active = sort.active;
        this.user.settings.dashboardSettings.tableSettings.direction = sort.direction as OrderByDirection;
        await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
      }
    });
    if (this.events) {
      this.processChanges('after_view_init');
    }
  }

  checkBoxClick(row) {
    this.selection.toggle(row);
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

  isAllSelected() {
    const numSelected = this.selection.selected.length;
    const numRows = this.data.data.length;
    return numSelected === numRows;
  }


  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle() {
    this.isAllSelected() ?
      this.selection.clear() :
      this.data.data.forEach(row => this.selection.select(row));
  }

  async mergeSelection(event) {
    if (this.selection.selected.length < 2) {
      this.snackBar.open('Select at least two events to merge', undefined, { duration: 2000 });
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

    try {
      const result = await this.eventMergeService.mergeEvents(eventIDs, mergeType);

      this.analyticsService.logEvent('merge_events');
      await this.router.navigate(['/user', this.user.uid, 'event', result.eventId], {});
      dialogRef.close(true);
      this.snackBar.open('Events merged', undefined, {
        duration: 2000,
      });
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
    }
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
    if (this.selection.selected.length > 20) {
      this.snackBar.open('Cannot download more than 20 events at once', 'Close', { duration: 3000 });
      return;
    }
    this.dialog.open(EventsExportFormComponent, {
      // width: '100vw',
      disableClose: false,
      data: {
        events: this.selection.selected.map(selected => selected.Event),
        user: this.user,
      },
    });
  }

  public async downloadOriginals() {

    if (this.selection.selected.length > 20) {
      this.snackBar.open('Cannot download more than 20 events at once', 'Close', { duration: 3000 });
      return;
    }

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
      const filesToDownload: { path: string, fileName: string }[] = [];
      let minDate: Date | null = null;
      let maxDate: Date | null = null;

      this.processingService.updateJob(jobId, { title: 'Gathering file info...', progress: 10 });

      for (const event of selectedEvents) {
        // Use shared utility for date conversion
        const startDate = this.fileService.toDate(event.startDate);

        if (startDate) {
          if (!minDate || startDate < minDate) minDate = startDate;
          if (!maxDate || startDate > maxDate) maxDate = startDate;
        }

        const appEvent = event as any;
        const eventId = event.getID ? event.getID() : null;

        // Handle array of original files
        if (appEvent.originalFiles && Array.isArray(appEvent.originalFiles) && appEvent.originalFiles.length > 0) {
          const totalFiles = appEvent.originalFiles.length;
          appEvent.originalFiles.forEach((fileMeta: any, index: number) => {
            if (fileMeta.path) {
              const extension = this.fileService.getExtensionFromPath(fileMeta.path);
              const fileDate = this.fileService.toDate(fileMeta.startDate) || startDate;
              const fileName = this.fileService.generateDateBasedFilename(
                fileDate, extension, index + 1, totalFiles, eventId
              );
              filesToDownload.push({ path: fileMeta.path, fileName });
            }
          });
        }
        // Handle legacy single original file
        else if (appEvent.originalFile && appEvent.originalFile.path) {
          const extension = this.fileService.getExtensionFromPath(appEvent.originalFile.path);
          const fileName = this.fileService.generateDateBasedFilename(startDate, extension, undefined, undefined, eventId);
          filesToDownload.push({ path: appEvent.originalFile.path, fileName });
        }
      }

      if (filesToDownload.length === 0) {
        this.snackBar.open('No original files available for selected events', undefined, { duration: 3000 });
        this.processingService.removeJob(jobId);
        return;
      }

      // Download all files
      this.processingService.updateJob(jobId, { title: `Downloading ${filesToDownload.length} files...`, progress: 20 });

      const downloadedFiles: { data: ArrayBuffer, fileName: string }[] = [];
      let completed = 0;

      for (const file of filesToDownload) {
        try {
          const data = await this.eventService.downloadFile(file.path);
          downloadedFiles.push({ data, fileName: file.fileName });
        } catch (e) {
          this.logger.error('Failed to download file:', file.path, e);
        }
        completed++;
        const progress = 20 + Math.round((completed / filesToDownload.length) * 60); // 20% to 80%
        this.processingService.updateJob(jobId, {
          progress,
          details: `Downloaded ${completed} of ${filesToDownload.length}`
        });
      }

      if (downloadedFiles.length === 0) {
        this.snackBar.open('Failed to download any files', undefined, { duration: 3000 });
        this.processingService.failJob(jobId, 'No files downloaded');
        return;
      }

      if (downloadedFiles.length === 1) {
        // Single file -> Direct download
        this.processingService.updateJob(jobId, { title: 'Preparing file...', progress: 90 });
        const file = downloadedFiles[0];
        const blob = new Blob([file.data]);
        // Extract extension from fileName (e.g., "2024-01-15.fit" -> "fit")
        const parts = file.fileName.split('.');
        const extension = parts.length > 1 ? parts.pop()! : 'fit';
        const baseNameWithoutExt = parts.join('.');
        this.fileService.downloadFile(blob, baseNameWithoutExt, extension);
        this.processingService.completeJob(jobId, 'Downloaded 1 file');
        this.analyticsService.logEvent('download_originals', { count: 1 });
      } else {
        // Multiple files -> ZIP
        this.processingService.updateJob(jobId, { title: 'Zipping files...', progress: 85 });

        // Generate ZIP filename using shared utility
        const zipFileName = this.fileService.generateDateRangeZipFilename(minDate, maxDate);

        // Create and download ZIP
        await this.fileService.downloadAsZip(downloadedFiles, zipFileName);

        this.processingService.completeJob(jobId, `Downloaded ${downloadedFiles.length} files`);
        this.analyticsService.logEvent('download_originals', { count: downloadedFiles.length });
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

  private updateDisplayedColumns() {
    const sortedSelectedColumns = (this.selectedColumns || [])
      .filter(column => column !== 'Description')
      .sort((a, b) => this.defaultSelectedColumns.indexOf(a) - this.defaultSelectedColumns.indexOf(b));

    const columns = [
      'Checkbox',
      'Start Date',
      ...sortedSelectedColumns,
      'Description',
      'Actions',
    ];

    this.displayedColumns = this.showActions
      ? columns
      : columns.filter(column => column !== 'Checkbox' && column !== 'Actions');
  }

  async saveEventDescription(description: string, event: EventInterface) {
    event.description = description;
    await this.eventService.updateEventProperties(this.user, event.getID(), {
      description: event.description,
    });
    this.snackBar.open('Event saved', undefined, {
      duration: 2000,
    });
  }

  async saveEventName(name: string, event: EventInterface) {
    event.name = name;
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
      this.user.settings.dashboardSettings.tableSettings.eventsPerPage = pageEvent.pageSize;
      return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
    }
  }

  searchTerm: string = '';

  search(searchTerm: string) {
    this.searchTerm = searchTerm;
    this.data.filter = searchTerm.trim().toLowerCase();
  }

  onSearchInput(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchSubject.next(filterValue);
  }

  clearSearch() {
    this.searchTerm = '';
    this.search('');
  }

  onKeyUp(event: KeyboardEvent) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchSubject.next(filterValue);
  }

  async selectedColumnsChange(event: string[]) {
    this.selectedColumns = event
    this.updateDisplayedColumns();
    this.user.settings.dashboardSettings.tableSettings.selectedColumns = this.selectedColumns
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  ngOnDestroy() {
    this.unsubscribeFromAll();
    if (this.breakpointSubscription) {
      this.breakpointSubscription.unsubscribe();
    }
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
    const rows: StatRowElement[] = [];

    this.selection.clear();
    for (const event of this.events) {
      if (!event) {
        continue;
      }

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

      statRowElement['Privacy'] = event.privacy;
      statRowElement['Name'] = event.name;
      statRowElement['Start Date'] = (event.startDate instanceof Date && !isNaN(+event.startDate)) ? this.datePipe.transform(event.startDate, dateFormat) : 'None?';
      statRowElement['Activity Types'] = event.getActivityTypesAsString();
      statRowElement['Merged Event'] = event.isMerge;
      statRowElement['Description'] = event.description;
      statRowElement['Device Names'] = event.getDeviceNamesAsString();
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

      // Add the sorts
      statRowElement['sort.Start Date'] = event.startDate.getTime();
      statRowElement['sort.Activity Types'] = statRowElement['Activity Types'];
      statRowElement['sort.Description'] = statRowElement['Description'];
      statRowElement['sort.Device Names'] = statRowElement['Device Names'];

      rows.push(statRowElement);
    }
    this.data.data = rows;
    this.logger.info('[perf] event_table_process_changes', {
      durationMs: Number((performance.now() - processStart).toFixed(2)),
      trigger,
      inputEvents: this.events.length,
      outputRows: this.data.data.length,
      isHandset: this.isHandset,
      pageSize: this.paginator?.pageSize || this.user.settings?.dashboardSettings?.tableSettings?.eventsPerPage || 0,
    });
    this.loaded();

  }

  private unsubscribeFromAll() {
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe();
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
