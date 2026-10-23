import { isCompleteEvent, type EventRead } from '@shared/event-read';
import type { ActivityFilterPickerOption } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { Auth } from 'app/firebase/auth';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Injectable,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
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
import { BenchmarkResult } from '@shared/app-event.interface';
import { MatTableDataSource } from '@angular/material/table';
import { SelectionModel } from '@angular/cdk/collections';
import { DatePipe } from '@angular/common';
import { ActivityInterface } from '@sports-alliance/sports-lib';

import { Privacy } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { debounceTime, map } from 'rxjs/operators';
import { firstValueFrom, race, Subject, Subscription } from 'rxjs';
import { rowsAnimation } from '../../animations/animations';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { AppUserService } from '../../services/app.user.service';
import { AppUserUtilities } from '../../utils/app.user.utilities';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { DataDeviceNames } from '@sports-alliance/sports-lib';
import { DataTableAbstractDirective, StatRowElement, EVENT_TABLE_STAT_TYPES } from '../data-table/data-table-abstract.directive';
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
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { EVENT_TAG_BULK_LIMIT, getEventTags, normalizeEventTagSuggestions } from '@shared/event-tags';
import { EventTagsDialogComponent } from '../event-tags/event-tags-dialog.component';
import { EventTagsBulkDialogComponent } from '../event-tags/event-tags-bulk-dialog.component';
import { resolveBenchmarkOverallGrade } from '../../helpers/benchmark-review.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { getTagLibraryActivityName } from '../../helpers/event-tag-library.helper';

interface EventTableRowCacheEntry {
  event: EventRead;
  eventRowContentKey: string;
  renderContextKey: string;
  row: StatRowElement;
}

interface DeviceNameDisplayItem {
  label: string;
  color: string;
  trackKey: string;
}

export type EventTablePresentation = 'dashboard' | 'browse' | 'tag-library';

export interface EventTableEventsChange {
  userID: string;
  updatedTags: Record<string, string[]>;
  deletedEventIDs: string[];
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
  private readonly sendAuth = inject(Auth, { optional: true });
  get canSendOwnedActivities(): boolean { return !!this.user && this.sendAuth?.currentUser?.uid === this.user.uid && (!this.targetUser || this.targetUser.uid === this.user.uid); }
  async sendToService(): Promise<void> {
    if (!this.canSendOwnedActivities) return;
    const ids = this.selection.selected.map(row => row.Event.getID());
    if (!ids.length || ids.length > 50) { this.snackBar.open('Select up to 50 activities to send.', undefined, { duration: 4000 }); return; }
    const opened = await this.router.navigate(['/send-activities'], { queryParams: { source: 'saved' }, state: { activitySendSelection: ids, activitySendOwner: this.user.uid } });
    if (opened) this.hapticsService.selection();
  }

  @Input() user!: User;
  @Input() events!: EventRead[];
  @Input() targetUser!: User;
  @Input() showActions!: boolean;
  @Input() presentation: EventTablePresentation = 'dashboard';
  @Input() showTagFilter = true;
  @Input() filterContext = '';
  @Input() preserveSearchOnFilterChange = false;
  @Input() hideGeneratedNames = false;
  @Input() emptyMessage = 'No activities yet';
  @Input() emptyHint = 'Import an activity or change your filters';
  @Output() eventsChange = new EventEmitter<EventTableEventsChange>();
  @ViewChild(MatSort, { static: true }) sort!: MatSort;
  @ViewChild(MatPaginator, { static: true }) paginator!: MatPaginator;
  @ViewChild(MatCard, { static: true }) table!: MatCard;

  data: MatTableDataSource<any> = new MatTableDataSource<StatRowElement>();
  selection = new SelectionModel(true, []);

  selectedColumns = AppUserUtilities.getDefaultSelectedTableColumns();
  private libraryColumns = ['Distance', 'Duration'];
  private libraryPageSize = 5;
  private libraryPageIndex = 0;
  private suppressLibraryPageFeedback = false;
  private librarySort = { active: 'Start Date', direction: 'desc' as 'asc' | 'desc' };
  readonly libraryAvailableColumns = [
    'Distance', 'Duration',
    ...AppUserUtilities.getDefaultSelectedTableColumns()
      .filter(column => !['Start Date', 'Activity Types', 'Name', 'Description', 'Distance', 'Duration'].includes(column)),
  ];
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
    'Library Activity Name',
    'Library Activity Label',
  ]);
  private readonly duplicateSourceFilesMessage = 'Selected activities include identical source files. Deselect duplicates and try again.';
  readonly sharedEventTooltip = 'Public link enabled. Anyone with the link can view this activity, comparison data, and original files.';
  private rowCache = new Map<string, EventTableRowCacheEntry>();
  private destroyed = false;


  private searchSubject: Subject<string> = new Subject();
  private analyticsService = inject(AppAnalyticsService);
  private hapticsService = inject(AppHapticsService);
  private eventTagService = inject(EventTagService);
  private eventTagCatalogService = inject(EventTagCatalogService);
  private allHistoryTags: string[] | null = null;
  private tagCatalogUserID: string | null = null;
  private tagCatalogRequestVersion = 0;
  public tagCatalogIsLoading = false;
  public tagCatalogLoadFailed = false;
  public canLoadTagCatalog = false;
  public tagFilters: string[] = [];
  public untaggedFilter = false;
  public tagPickerOptions: ActivityFilterPickerOption[] = [];
  public tagPickerValues: string[] = [];
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

  get isBrowsePresentation(): boolean {
    return this.presentation === 'browse';
  }

  get isLibraryPresentation(): boolean {
    return this.presentation === 'tag-library';
  }

  get showToolbar(): boolean {
    return !this.isBrowsePresentation;
  }

  get canManageEvents(): boolean {
    return !this.isBrowsePresentation && !!this.showActions;
  }

  get showRowActions(): boolean {
    return !!this.showActions;
  }

  get tableSortActive(): string {
    if (this.isLibraryPresentation) return this.librarySort.active;
    return this.user?.settings?.dashboardSettings?.tableSettings?.active || 'Start Date';
  }

  get tableSortDirection(): 'asc' | 'desc' {
    if (this.isLibraryPresentation) return this.librarySort.direction;
    return this.user?.settings?.dashboardSettings?.tableSettings?.direction === 'asc' ? 'asc' : 'desc';
  }

  get tablePageSize(): number {
    if (this.isLibraryPresentation) return this.libraryPageSize;
    const pageSize = this.user?.settings?.dashboardSettings?.tableSettings?.eventsPerPage;
    return Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10;
  }

  ngOnChanges(simpleChanges: SimpleChanges): void {
    const preferencesChanged = this.user && (simpleChanges.user || simpleChanges.presentation);
    if (preferencesChanged) {
      // The loading base renders synchronously. Initialize the picker first so
      // Material does not retain options created with Dashboard defaults.
      this.selectedColumns = this.isLibraryPresentation ? this.libraryColumns
        : this.user.settings?.dashboardSettings?.tableSettings?.selectedColumns || AppUserUtilities.getDefaultSelectedTableColumns();
    }
    this.isLoading ? this.loading() : this.loaded();
    if (!this.events) {
      this.rowCache.clear();
      this.loading();
      return;
    }
    if (this.events && (simpleChanges.events || preferencesChanged || simpleChanges.hideGeneratedNames) && this.paginator && this.sort) {
      this.processChanges(simpleChanges.presentation ? 'on_changes_presentation' : 'on_changes_events', true);
    }
    if (preferencesChanged) {
      const nextPageSize = this.tablePageSize;
      if (!this.isLibraryPresentation && this.paginator && this.paginator.pageSize !== nextPageSize) {
        this.paginator._changePageSize(nextPageSize);
      }
      this.updateDisplayedColumns();
    }
    if (simpleChanges.showActions || simpleChanges.presentation) {
      if (this.isBrowsePresentation) {
        this.searchTerm = '';
        this.tagFilters = [];
        this.untaggedFilter = false;
        this.selection.clear();
        this.applyTableFilter();
      }
      this.updateDisplayedColumns();
    }
    if (simpleChanges.showTagFilter && !this.showTagFilter) {
      this.tagFilters = [];
      this.untaggedFilter = false;
      this.applyTableFilter();
    }
    if (simpleChanges.filterContext) {
      if (!this.preserveSearchOnFilterChange) {
        this.searchTerm = '';
        this.searchSubject.next('');
      }
      this.tagFilters = [];
      this.untaggedFilter = false;
      this.selection.clear();
      this.suppressLibraryPageFeedback = true;
      this.paginator?.firstPage();
      this.suppressLibraryPageFeedback = false;
      this.libraryPageIndex = 0;
      this.applyTableFilter();
    }
    if (simpleChanges.user || simpleChanges.targetUser || simpleChanges.presentation) {
      void this.loadAllHistoryTags();
    }
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error(`Component needs user`)
    }
    void this.loadAllHistoryTags();
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
        if (this.events && this.paginator && this.sort) {
          this.processChanges('breakpoint_change', true);
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
      if (filterState.tags.length || filterState.untagged) {
        const selected = new Set(filterState.tags.map(tag => tag.toLowerCase()));
        const rowTags: string[] = Array.isArray(row['Tag Values']) ? row['Tag Values'] : [];
        if (!rowTags.some(tag => selected.has(tag.toLowerCase())) && !(filterState.untagged && !rowTags.length)) return false;
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
      if (this.isBrowsePresentation) {
        return;
      }
      if (this.isLibraryPresentation) {
        const direction = sort.direction === 'asc' ? 'asc' : 'desc';
        if (sort.active !== this.librarySort.active || direction !== this.librarySort.direction) this.hapticsService.selection();
        this.librarySort = { active: sort.active, direction };
        return;
      }
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
    this.hapticsService.selection();
  }

  clearSelection(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.selection.selected.length === 0) {
      return;
    }
    this.selection.clear();
    this.hapticsService.selection();
  }

  public removeDeletedEvent(eventID: string): void {
    if (!eventID || !this.events || !this.user) {
      return;
    }
    const nextEvents = this.events.filter(event => event?.getID() !== eventID);
    if (nextEvents.length !== this.events.length) {
      this.events = nextEvents;
      this.processChanges('after_delete_row');
    }
    this.eventsChange.emit({ userID: this.user.uid, updatedTags: {}, deletedEventIDs: [eventID] });
  }

  public refreshSavedAscent(event: EventRead): void {
    if (this.destroyed || !this.user || !this.events?.includes(event)) return;
    this.invalidateRowCacheForEvent(event);
    this.processChanges('ascent_saved', true);
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
  async openBenchmarkFlow(event: Event, eventRead: EventRead): Promise<void> {
    event.stopPropagation();
    event.preventDefault();

    const user = this.user;
    const ownerID = (this.targetUser || user)?.uid;
    const isCurrent = () => !this.destroyed && this.user?.uid === user?.uid && (this.targetUser || this.user)?.uid === ownerID;
    let appEvent;
    try {
      appEvent = await this.loadCompleteEvent(eventRead);
    } catch (error) {
      if (!isCurrent()) return;
      this.logger.error('Could not load activity for benchmark', error);
      this.snackBar.open('Could not load activity', undefined, { duration: 3000 });
      this.hapticsService.error();
      return;
    }
    if (!isCurrent()) return;
    const initialSelection = appEvent.getActivities().slice(0, 2);
    const result = this.getFirstBenchmarkResult(appEvent);

    if (result) {
      this.benchmarkFlow.openBenchmarkReport({
        event: appEvent,
        hydrateStreamsForGeneration: true,
        persistEvent: appEvent,
        user,
        result,
        initialSelection
      });
    } else {
      this.benchmarkFlow.openBenchmarkSelectionDialog({
        event: appEvent,
        hydrateStreamsForGeneration: true,
        persistEvent: appEvent,
        user,
        initialSelection
      });
    }
  }

  getBenchmarkColor(appEvent: EventRead): string {
    const result = this.getFirstBenchmarkResult(appEvent);
    if (!result) return '';

    const grade = resolveBenchmarkOverallGrade(result);
    if (grade === 'excellent' || grade === 'good') return AppColors.Green;
    if (grade === 'poor') return AppColors.Red;
    return AppColors.Orange;
  }

  private getFirstBenchmarkResult(appEvent: EventRead): BenchmarkResult | null {
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
    const event = row?.Event as EventRead | undefined;
    return event?.getID ? event.getID() : index;
  }

  private getSelectableRows(): any[] {
    const rows = Array.isArray(this.data.filteredData) ? this.data.filteredData : this.data.data;
    if (!this.isLibraryPresentation) return rows;
    const sortedRows = this.data.sort ? this.data.sortData([...rows], this.data.sort) : rows;
    const pageSize = this.paginator?.pageSize || this.tablePageSize;
    const pageIndex = this.paginator?.pageIndex || 0;
    return sortedRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  }

  get isSelectionIndeterminate(): boolean {
    const rows = this.getSelectableRows();
    const selectedCount = rows.filter(row => this.selection.isSelected(row)).length;
    return selectedCount > 0 && selectedCount < rows.length;
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
    if (selectableRows.length === 0) {
      return;
    }
    if (this.isAllSelected()) {
      selectableRows.forEach(row => this.selection.deselect(row));
    } else {
      selectableRows.forEach(row => this.selection.select(row));
    }
    this.hapticsService.selection();
  }

  private collectSourceFilePaths(event: EventRead): string[] {
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

  private hasDuplicateSourceFilePaths(events: EventRead[]): boolean {
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
      this.snackBar.open('Select at least two activities to merge', undefined, { duration: 2000 });
      return;
    }

    const selectedRows = [...this.selection.selected] as StatRowElement[];
    const selectedEvents = selectedRows
      .map((selected) => selected?.Event as EventRead | undefined)
      .filter((selectedEvent): selectedEvent is EventRead => !!selectedEvent);

    if (this.hasDuplicateSourceFilePaths(selectedEvents)) {
      this.snackBar.open(this.duplicateSourceFilesMessage, undefined, { duration: 4000 });
      return;
    }

    this.hapticsService.selection();
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

    this.loading();

    const eventIDs = selectedRows
      .map((selected) => selected?.Event?.getID?.())
      .filter((eventID): eventID is string => !!eventID);

    if (eventIDs.length < 2) {
      this.restoreEventSelection(selectedRows);
      this.loaded();
      this.snackBar.open('Not enough activities to merge', undefined, { duration: 3000 });
      dialogRef.disableClose = false;
      dialogRef.componentInstance.isMerging = false;
      dialogRef.close(null);
      return;
    }

    let result: MergeEventResponse;
    try {
      result = await this.eventMergeService.mergeEvents(eventIDs, mergeType);
    } catch (error) {
      this.restoreEventSelection(selectedRows);
      this.logger.captureException(error, {
        extra: {
          sourceEventsCount: eventIDs.length,
          mergeType,
        }
      });
      this.loaded();
      this.snackBar.open(this.eventMergeService.getMergeErrorMessage(error), undefined, {
        duration: 5000,
      });
      this.hapticsService.error();
      dialogRef.disableClose = false;
      dialogRef.componentInstance.isMerging = false;
      dialogRef.close(null);
      return;
    }

    this.selection.clear();

    try {
      this.analyticsService.logEvent('merge_events');
    } catch (error) {
      this.logger.warn('Failed to log merge event analytics.', error);
    }

    dialogRef.close(true);
    this.hapticsService.success();

    try {
      const navigated = await this.router.navigate(['/user', this.user.uid, 'event', result.eventId], {});
      if (navigated) {
        this.snackBar.open('Activities merged', undefined, {
          duration: 2000,
        });
        return;
      }
    } catch (error) {
      this.logger.captureException(error, {
        extra: {
          sourceEventsCount: eventIDs.length,
          mergeType,
          mergedEventID: result.eventId,
          stage: 'open_merged_event',
        }
      });
    }

    this.loaded();
    this.snackBar.open('Activities merged. Open the merged activity from the table once it appears.', undefined, {
      duration: 5000,
    });
  }

  async deleteSelection() {
    const user = this.user;
    const eventIDs = [...new Set(this.selection.selected
      .map(selected => selected.Event?.getID())
      .filter((eventID): eventID is string => !!eventID))];
    if (!user || !eventIDs.length) return;
    this.loading();
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: eventIDs.length === 1 ? 'Delete activity?' : `Delete ${eventIDs.length} activities?`,
        message: 'The selected activities, their recorded data and original files will be permanently deleted. You cannot undo this.',
        confirmLabel: eventIDs.length === 1 ? 'Delete activity' : 'Delete activities',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      }
    });
    this.deleteConfirmationSubscription = dialogRef.afterClosed().subscribe(async (result) => {
      if (!result || !this.isCurrentMutationOwner(user)) {
        if (this.isCurrentMutationOwner(user)) this.loaded();
        return;
      }
      try {
        this.selection.clear();
        const outcomes = await Promise.allSettled(eventIDs.map(eventID =>
          this.eventService.deleteAllEventData(user, eventID)));
        if (!this.isCurrentMutationOwner(user)) return;
        const deletedIds = new Set(eventIDs.filter((_eventID, index) => outcomes[index].status === 'fulfilled'));

        // Reconcile each confirmed result even when another deletion failed.
        if (deletedIds.size > 0) {
          if (this.events) {
            this.events = this.events.filter(e => !deletedIds.has(e.getID()));
            this.processChanges('after_delete_selection');
          }
          this.eventsChange.emit({ userID: user.uid, updatedTags: {}, deletedEventIDs: [...deletedIds] });
        }
        const failure = outcomes.find(outcome => outcome.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;

        this.analyticsService.logEvent('delete_events');
        this.snackBar.open('Activities deleted', undefined, {
          duration: 2000,
        });
        this.hapticsService.success();
      } catch (error) {
        if (!this.isCurrentMutationOwner(user)) return;
        this.logger.error('[EventTableComponent] Failed to delete selected events', error);
        this.snackBar.open('Could not delete selected activities', undefined, {
          duration: 3000,
        });
        this.hapticsService.error();
      } finally {
        if (this.isCurrentMutationOwner(user)) this.loaded();
      }
    });
  }

  public downloadAsCSV(event) {
    if (this.selection.selected.length > 0) {
      this.hapticsService.selection();
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

  private async loadCompleteEvent(event: EventRead) {
    if (isCompleteEvent(event)) {
      // Full readers can be passed through; summaries must be fetched explicitly.
      return event;
    }
    const fullEvent = await firstValueFrom(this.eventService.getEventAndActivities(this.targetUser || this.user, event.getID()));
    if (!fullEvent) throw new Error('Activity no longer exists');
    return fullEvent;
  }

  public async downloadGPXSelection() {
    const jobId = this.processingService.addJob('download', 'Preparing GPX export...');

    try {
      const selectedEvents = this.selection.selected.map(selected => selected.Event) as EventRead[];
      if (selectedEvents.length === 0) {
        this.snackBar.open('No activities selected', undefined, { duration: 2000 });
        this.processingService.removeJob(jobId);
        return;
      }
      this.hapticsService.selection();

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
          const data = await this.eventService.getEventAsGPXBloB(this.targetUser || this.user, await this.loadCompleteEvent(event));
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
        this.snackBar.open('Could not export GPX for selected activities', undefined, { duration: 3000 });
        this.processingService.failJob(jobId, 'No GPX files exported');
        this.hapticsService.error();
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
          `Downloaded ${downloadedCount} GPX ${downloadedCount === 1 ? 'file' : 'files'}. Skipped ${failedCount} ${failedCount === 1 ? 'activity' : 'activities'}.`,
          undefined,
          { duration: 4000 },
        );
        this.hapticsService.warning();
        return;
      }

      this.snackBar.open(selectedEvents.length === 1 ? 'GPX file served' : 'GPX files served', undefined, {
        duration: 2000,
      });
      this.hapticsService.success();
    } catch (error) {
      this.logger.error('Error exporting GPX files:', error);
      this.processingService.failJob(jobId, 'GPX export failed');
      this.snackBar.open('Error exporting GPX files', undefined, { duration: 3000 });
      this.hapticsService.error();
    }
  }

  public async downloadOriginals() {
    // Start background job instead of blocking UI
    const jobId = this.processingService.addJob('download', 'Preparing download...');

    try {
      const selectedEvents = this.selection.selected.map(s => s.Event) as EventRead[];
      if (selectedEvents.length === 0) {
        this.snackBar.open('No activities selected', undefined, { duration: 2000 });
        this.processingService.removeJob(jobId);
        return;
      }
      this.hapticsService.selection();

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
        this.snackBar.open('No original files available for selected activities', undefined, { duration: 3000 });
        this.processingService.removeJob(jobId);
        this.hapticsService.error();
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
        this.hapticsService.error();
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
        this.hapticsService.warning();
        return;
      }
      this.hapticsService.success();
    } catch (e) {
      this.logger.error('Error downloading originals:', e);
      this.processingService.failJob(jobId, 'Download failed');
      this.snackBar.open('Error downloading files', undefined, { duration: 3000 });
      this.hapticsService.error();
    }
  }

  // Todo cache this please
  getColumnsToDisplay() {
    return this.displayedColumns;
  }

  override isColumnHeaderSortable(columnName: string): boolean {
    if (columnName === 'Name' && this.isLibraryPresentation) return true;
    return columnName === 'Shared' || super.isColumnHeaderSortable(columnName);
  }

  private updateDisplayedColumns() {
    if (this.isLibraryPresentation) {
      this.displayedColumns = [
        ...(this.canManageEvents ? ['Checkbox'] : []), 'Start Date', 'Name',
        ...this.libraryColumns, 'Tags', ...(this.showRowActions ? ['Actions'] : []),
      ];
      return;
    }
    const sortedSelectedColumns = (this.selectedColumns || [])
      .filter(column => column !== 'Description' && column !== 'Shared' && column !== 'Tags')
      .sort((a, b) => this.defaultSelectedColumns.indexOf(a) - this.defaultSelectedColumns.indexOf(b));

    const activityTypeColumn = sortedSelectedColumns.find(column => column === 'Activity Types');
    const remainingSelectedColumns = activityTypeColumn
      ? sortedSelectedColumns.filter(column => column !== activityTypeColumn)
      : sortedSelectedColumns;
    const tagColumn = this.isBrowsePresentation ? [] : ['Tags'];
    const dataColumns = this.isHandset
      ? [...(activityTypeColumn ? [activityTypeColumn] : []), ...tagColumn, ...remainingSelectedColumns]
      : [...sortedSelectedColumns, ...tagColumn];

    const columns = [
      'Checkbox',
      'Start Date',
      ...dataColumns,
      'Description',
      'Shared',
      'Actions',
    ];

    this.displayedColumns = columns.filter(column => {
      if (column === 'Checkbox' || column === 'Shared') {
        return this.canManageEvents;
      }
      if (column === 'Actions') {
        return this.showRowActions;
      }
      return true;
    });
  }

  async saveEventDescription(description: string, event: EventRead) {
    event.description = description;
    this.invalidateRowCacheForEvent(event);
    await this.eventService.updateEventProperties(this.user, event.getID(), {
      description: event.description,
    });
    this.snackBar.open('Activity saved', undefined, {
      duration: 2000,
    });
  }

  async saveEventName(name: string, event: EventRead) {
    event.name = name;
    this.invalidateRowCacheForEvent(event);
    await this.eventService.updateEventProperties(this.user, event.getID(), {
      name: event.name,
    });
    this.snackBar.open('Activity saved', undefined, {
      duration: 2000,
    });
  }

  // Noop due to bugs
  async pageChanges(pageEvent: PageEvent) {
    if (this.isLibraryPresentation) {
      const pageIndex = pageEvent.pageIndex ?? this.paginator?.pageIndex ?? 0;
      const previousPageIndex = pageEvent.previousPageIndex ?? this.libraryPageIndex;
      if (!this.suppressLibraryPageFeedback && (pageIndex !== previousPageIndex || pageEvent.pageSize !== this.libraryPageSize)) this.hapticsService.selection();
      this.libraryPageIndex = pageIndex;
      this.libraryPageSize = pageEvent.pageSize;
      return;
    }
    if (this.isBrowsePresentation) {
      return;
    }
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

  updateTagFilters(values: readonly string[]): void {
    const tags = this.tagFilterOptions.filter(tag => values.includes(`tag:${tag.toLowerCase()}`));
    const untagged = values.includes('untagged');
    if (tags.length === this.tagFilters.length && tags.every(tag => this.tagFilters.includes(tag)) && untagged === this.untaggedFilter) return;
    this.tagFilters = tags;
    this.untaggedFilter = untagged;
    this.hapticsService.selection();
    this.paginator?.firstPage();
    this.applyTableFilter();
  }

  onTagFilterOpened(opened: boolean): void {
    if (opened) {
      void this.loadAllHistoryTags(false, true);
    }
  }

  async openEventTagsDialog(domEvent: Event, event: EventRead): Promise<void> {
    domEvent.preventDefault();
    domEvent.stopPropagation();
    if (!this.showActions || !this.user || !event?.getID?.()) {
      return;
    }
    const user = this.user;
    this.hapticsService.selection();
    const originalTags = this.eventTagService.getTags(event);

    const dialogRef = this.dialog.open(EventTagsDialogComponent, {
      width: 'min(34rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        title: 'Activity tags',
        tags: originalTags,
        suggestions: this.tagFilterOptions,
        save: async (tags: string[]) => {
          const savedTags = await this.eventTagService.saveTags(user, event, tags, originalTags);
          if (this.isCurrentMutationOwner(user)) {
            this.applySavedTagsToLoadedEvent(event.getID(), savedTags, event);
            this.eventsChange.emit({ userID: user.uid, updatedTags: { [event.getID()]: savedTags }, deletedEventIDs: [] });
          }
          return savedTags;
        },
      },
    });
    const savedTags = await firstValueFrom(dialogRef.afterClosed());
    if (!Array.isArray(savedTags) || !this.isCurrentMutationOwner(user)) {
      return;
    }

    this.processChanges('event_tags_saved');
    void this.loadAllHistoryTags(true);
    this.snackBar.open('Tags saved.', undefined, { duration: 2000 });
  }

  async openBulkEventTagsDialog(domEvent: Event): Promise<void> {
    domEvent.preventDefault();
    domEvent.stopPropagation();
    if (this.isBulkTagSaving || !this.user || !this.selection.selected.length) {
      return;
    }
    const user = this.user;
    if (this.selection.selected.length > EVENT_TAG_BULK_LIMIT) {
      this.snackBar.open(
        `Select up to ${EVENT_TAG_BULK_LIMIT} activities to update tags.`,
        undefined,
        { duration: 3000 },
      );
      return;
    }

    const selectedEvents = this.selection.selected
      .map(row => row?.Event as EventRead | undefined)
      .filter((event): event is EventRead => !!event?.getID?.());
    const selectedEventIDs = selectedEvents.map(event => event.getID());
    if (!selectedEventIDs.length) {
      this.snackBar.open('Select at least one valid activity to update tags.', undefined, { duration: 2500 });
      return;
    }
    this.hapticsService.selection();
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
            savedResults = await this.eventTagService.applyBulkChanges(user, selectedEventIDs, changes);
            if (this.isCurrentMutationOwner(user)) {
              selectedEvents.forEach((event) => {
                const eventID = event.getID();
                this.applySavedTagsToLoadedEvent(eventID, savedResults?.[eventID] || getEventTags(event), event);
              });
              this.eventsChange.emit({ userID: user.uid, updatedTags: savedResults, deletedEventIDs: [] });
            }
            return savedResults;
          } finally {
            this.isBulkTagSaving = false;
          }
        },
      },
    });

    const didSave = await firstValueFrom(dialogRef.afterClosed());
    if (!didSave || !savedResults || !this.isCurrentMutationOwner(user)) {
      return;
    }
    this.processChanges('bulk_event_tags_saved');
    void this.loadAllHistoryTags(true);
    this.snackBar.open(
      `Tags updated on ${selectedEvents.length} ${selectedEvents.length === 1 ? 'activity' : 'activities'}.`,
      undefined,
      { duration: 2500 },
    );
  }

  private isCurrentMutationOwner(user: User): boolean {
    return !this.destroyed && this.user?.uid === user.uid;
  }

  private applySavedTagsToLoadedEvent(
    eventID: string,
    tags: string[],
    fallbackEvent: EventRead,
  ): void {
    fallbackEvent.tags = tags;
    delete fallbackEvent.benchmarkReviewTags;
    const loadedEvent = this.events.find(event => event.getID() === eventID) as EventRead | undefined;
    if (loadedEvent && loadedEvent !== fallbackEvent) {
      loadedEvent.tags = tags;
      delete loadedEvent.benchmarkReviewTags;
    }
    this.invalidateRowCacheForEvent(loadedEvent || fallbackEvent);
  }

  private restoreEventSelection(selectedRows: StatRowElement[]): void {
    const currentRows = this.data.data as StatRowElement[];
    const currentRowsByEventID = new Map<string, StatRowElement>();
    currentRows.forEach((row) => {
      const eventID = row?.Event?.getID?.();
      if (eventID) {
        currentRowsByEventID.set(eventID, row);
      }
    });

    this.selection.clear();
    selectedRows.forEach((fallbackRow) => {
      const eventID = fallbackRow?.Event?.getID?.();
      const currentRow = eventID ? currentRowsByEventID.get(eventID) : undefined;
      if (currentRow) {
        this.selection.select(currentRow);
      } else if (eventID && currentRows.length === 0) {
        this.selection.select(fallbackRow);
      }
    });
  }

  onSearchInput(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchTerm = filterValue;
    this.searchSubject.next(filterValue);
  }

  clearSearch() {
    if (!this.searchTerm) return;
    this.searchTerm = '';
    this.searchSubject.next('');
    this.search('');
    this.hapticsService.selection();
  }

  private applyTableFilter(): void {
    this.tagPickerValues = [...this.tagFilters.map(tag => `tag:${tag.toLowerCase()}`), ...(this.untaggedFilter ? ['untagged'] : [])];
    this.data.filter = JSON.stringify({
      text: this.searchTerm.trim().toLowerCase(), tags: this.tagFilters, untagged: this.untaggedFilter,
    });
  }

  private parseTableFilter(filter: string): { text: string; tags: string[]; untagged: boolean } {
    try {
      const parsed = JSON.parse(filter || '{}') as { text?: unknown; tags?: unknown; untagged?: unknown };
      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        untagged: parsed.untagged === true,
      };
    } catch {
      return { text: `${filter || ''}`, tags: [], untagged: false };
    }
  }

  onKeyUp(event: KeyboardEvent) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchSubject.next(filterValue);
  }

  async selectedColumnsChange(event: string[]) {
    if (this.isBrowsePresentation) {
      return;
    }
    if (event.length === this.selectedColumns.length && event.every((column, index) => column === this.selectedColumns[index])) {
      return;
    }
    if (this.isLibraryPresentation) {
      // Material's selected-options order can change as choices are toggled.
      this.libraryColumns = this.libraryAvailableColumns.filter(column => event.includes(column));
      this.selectedColumns = this.libraryColumns;
      this.updateDisplayedColumns();
      return;
    }
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
    this.destroyed = true;
    this.tagCatalogRequestVersion += 1;
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

  private async loadAllHistoryTags(force = false, checkCache = false): Promise<void> {
    // Event collection listing is owner-only. Public/other-user views retain their loaded-row tags.
    const userID = this.user?.uid;
    if (!this.showToolbar || !userID || (this.targetUser && this.targetUser.uid !== userID)) {
      this.canLoadTagCatalog = false;
      this.tagCatalogRequestVersion += 1;
      this.tagCatalogUserID = null;
      this.allHistoryTags = null;
      this.tagCatalogIsLoading = false;
      this.tagCatalogLoadFailed = false;
      this.updateTagFilterOptions();
      return;
    }
    this.canLoadTagCatalog = true;
    const sameUser = this.tagCatalogUserID === userID;
    if (!force && sameUser && (this.tagCatalogIsLoading
      || (!checkCache && this.allHistoryTags !== null && !this.tagCatalogLoadFailed))) {
      return;
    }

    if (!sameUser) {
      this.allHistoryTags = null;
    }
    this.tagCatalogUserID = userID;
    this.tagCatalogIsLoading = true;
    this.tagCatalogLoadFailed = false;
    const requestVersion = ++this.tagCatalogRequestVersion;
    try {
      const tags = await this.eventTagCatalogService.listAllTags(userID, force);
      if (requestVersion !== this.tagCatalogRequestVersion) {
        return;
      }
      this.allHistoryTags = tags;
      this.tagCatalogIsLoading = false;
      this.updateTagFilterOptions();
      this.changeDetector.markForCheck();
    } catch (error) {
      if (requestVersion === this.tagCatalogRequestVersion) {
        this.tagCatalogIsLoading = false;
        this.tagCatalogLoadFailed = true;
        this.updateTagFilterOptions();
        this.changeDetector.markForCheck();
        this.logger.warn('[EventTableComponent] Could not load all activity tags.', error);
      }
    }
  }

  private updateTagFilterOptions(): void {
    const rows = this.data.data as StatRowElement[];
    this.tagFilterOptions = normalizeEventTagSuggestions([
      ...(this.allHistoryTags || []),
      ...rows.flatMap(row => row['Tag Values'] || []),
      ...((this.tagCatalogIsLoading || this.tagCatalogLoadFailed) ? this.tagFilters : []),
    ]).sort((first, second) => first.localeCompare(second));
    this.tagPickerOptions = [
      { value: 'untagged', label: 'Untagged', icon: 'label_off' },
      ...this.tagFilterOptions.map(tag => ({ value: `tag:${tag.toLowerCase()}`, label: tag, icon: 'sell' })),
    ];
    const selected = new Set(this.tagFilters.map(tag => tag.toLowerCase()));
    this.tagFilters = this.tagFilterOptions.filter(tag => selected.has(tag.toLowerCase()));
    this.applyTableFilter();
  }

  private processChanges(trigger: string = 'unknown', preserveSelection: boolean = false) {
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
    const selectedEventIDs = preserveSelection
      ? new Set(
        this.selection.selected
          .map(row => this.getEventID(row?.Event))
          .filter((eventID): eventID is string => !!eventID),
      )
      : new Set<string>();

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
    this.selection.clear();
    if (selectedEventIDs.size > 0) {
      rows.forEach((row) => {
        const eventID = this.getEventID(row?.Event);
        if (eventID && selectedEventIDs.has(eventID)) {
          this.selection.select(row);
        }
      });
    }
    this.updateTagFilterOptions();
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
    // Rebuilding display rows must not complete the parent's history request.
    this.changeDetector.detectChanges();

  }

  private buildRowElement(
    event: EventRead,
    dateFormat: string,
    removedAscentTypes: Set<ActivityTypes>,
    removedDescentTypes: Set<ActivityTypes>,
  ): StatRowElement {
    const activityTypes = event.getActivityTypesAsArray();
    const statRowElement = this.getStatsRowElementFromReader(
      event,
      activityTypes.length ? activityTypes : [ActivityTypes.unknown],
      this.user.settings.unitSettings,
      event.isMerge
    );
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
    const activityName = getTagLibraryActivityName(event);
    statRowElement['Name'] = this.hideGeneratedNames && !activityName ? '' : event.name;
    statRowElement['Start Date'] = startDate ? this.datePipe.transform(startDate, dateFormat) : 'None?';
    statRowElement['Activity Types'] = event.getActivityTypesAsString();
    if (this.isLibraryPresentation || this.hideGeneratedNames) {
      const name = activityName;
      const date = startDate ? this.datePipe.transform(startDate, 'd MMM y, HH:mm') : '';
      statRowElement['Library Activity Name'] = name;
      statRowElement['Library Activity Label'] = name || `${statRowElement['Activity Types'] || 'Activity'}${date ? ` on ${date}` : ''}`;
    }
    statRowElement['Merged Event'] = event.isMerge;
    statRowElement['Description'] = event.description;
    const tags = getEventTags(event as EventRead);
    statRowElement['Tags'] = tags.join(' ');
    statRowElement['Tag Values'] = tags;
    statRowElement['Tags Title'] = tags.join('\n');
    const eventLabel = statRowElement['Library Activity Label'] || event.name || 'activity';
    statRowElement['Tag Action Label'] = `${tags.length ? 'Edit' : 'Add'} activity tags for ${eventLabel}`;
    statRowElement['Tags Accessible Label'] = `Activity tags for ${eventLabel}: ${tags.join(', ')}`;
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
    statRowElement['sort.Name'] = this.isLibraryPresentation || this.hideGeneratedNames
      ? statRowElement['Library Activity Name'] || statRowElement['Activity Types'] || ''
      : event.name || event.description || '';
    statRowElement['sort.Activity Types'] = statRowElement['Activity Types'];
    statRowElement['sort.Description'] = statRowElement['Description'];
    statRowElement['sort.Device Names'] = statRowElement['Device Names'];
    statRowElement['sort.Shared'] = isShared ? 1 : 0;

    return statRowElement;
  }

  private isEventPubliclyShared(event: EventRead): boolean {
    return event?.privacy === Privacy.Public;
  }

  private buildDeviceNameDisplayItems(event: EventRead): DeviceNameDisplayItem[] {
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

  private getDeviceNamesFromStat(event: EventRead): string[] {
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
      owner: this.targetUser?.uid || this.user?.uid,
      dateFormat,
      presentation: this.presentation,
      hideGeneratedNames: this.hideGeneratedNames,
      unitSettings: this.user?.settings?.unitSettings ?? null,
      removeAscentForEventTypes: [...(summariesSettings?.removeAscentForEventTypes || [])].sort(),
      removeDescentForEventTypes: [...(summariesSettings?.removeDescentForEventTypes || [])].sort(),
    });
  }

  private buildEventRowContentKey(event: EventRead): string {
    const stats = this.readStatsForCacheKey(event);
    const benchmarkResults = (event as any).benchmarkResults;
    const startDate = event.startDate instanceof Date && !isNaN(+event.startDate)
      ? event.startDate.getTime()
      : null;

    return JSON.stringify({
      name: event.name ?? null,
      description: event.description ?? null,
      tags: getEventTags(event as EventRead),
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

  private readDeviceNameItemsForCacheKey(event: EventRead): unknown[] {
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

  private readStatsForCacheKey(event: EventRead): unknown[] {
    if (event.getReadRevision) return [event.getReadRevision([])];
    const types = [
      ...EVENT_TABLE_STAT_TYPES,
      ...event.getActivityTypesAsArray().flatMap(type => ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(
        ActivityTypes[type as keyof typeof ActivityTypes])),
    ];
    return [...new Set(types)].map(type => [type, this.normalizeCacheValue((event.getStat(type) || undefined)?.getValue())]);
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

  private getEventID(event: EventRead | undefined): string | null {
    if (!event) {
      return null;
    }

    const eventWithID = event as EventRead & { id?: string };
    if (typeof eventWithID.getID === 'function') {
      return eventWithID.getID() || null;
    }

    return eventWithID.id || null;
  }

  private invalidateRowCacheForEvent(event: EventRead | undefined): void {
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
