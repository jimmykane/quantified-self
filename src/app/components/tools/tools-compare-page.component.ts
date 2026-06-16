import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, OnInit, signal } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { Sort, SortDirection } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  ActivityInterface,
  ActivityTypes,
  ActivityTypesHelper,
  DataActivityTypes,
  DataAltitude,
  DataAscent,
  DataDescent,
  DataDistance,
  DataHeartRate,
  DataInterface,
  User,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkResult, getBenchmarkPairKey } from '@shared/app-event.interface';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { firstValueFrom } from 'rxjs';

import { AppAuthService } from '../../authentication/app.auth.service';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { SharedModule } from '../../modules/shared.module';
import {
  AppAnalyticsService,
  ToolCompareCreateAnalytics,
  ToolCompareErrorCategory,
  ToolCompareFileSelectionAnalytics,
  ToolCompareFileType,
  ToolCompareSavedActionAnalytics,
  ToolCompareSignInSource,
} from '../../services/app.analytics.service';
import { AppEventService, EventQueryCursor } from '../../services/app.event.service';
import {
  AppToolsComparisonService,
  SavedBenchmarkComparisonSortColumn,
  SavedBenchmarkComparisonsPage,
} from '../../services/app.tools-comparison.service';
import { LoggerService } from '../../services/logger.service';
import { ToolsCompareAuthResolverData } from '../../resolvers/tools-compare-auth.resolver';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppColors } from '../../services/color/app.colors';
import { AppDeviceColorPreferenceService } from '../../services/color/app-device-color-preference.service';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
import type { BenchmarkGenerationFailureReason } from '../../services/app.benchmark-flow.service';
import { BENCHMARK_NO_OVERLAP_MESSAGE } from '../../services/app.benchmark.service';
import { AppBreakpoints } from '../../constants/breakpoints';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { BenchmarkReviewService } from '../../services/benchmark-review.service';
import {
  DeviceColorPreferenceDialogDevice,
  DeviceColorPreferencesDialogComponent,
} from './device-color-preferences-dialog.component';
import { BenchmarkReviewTagsDialogComponent } from '../benchmark/benchmark-review-tags-dialog.component';
import {
  resolveBenchmarkStreamMeanDeviation,
  resolveBenchmarkStreamMetrics,
} from '../../helpers/benchmark-review.helper';
import {
  beginTableRowPointerTracking,
  cancelTableRowPointerTracking,
  createTableRowActivationState,
  endTableRowPointerTracking,
  shouldActivateTableRowFromClick,
  shouldActivateTableRowFromKeyboard,
  TableRowActivationState,
  updateTableRowPointerTracking,
} from '../../helpers/table-row-activation.helper';

interface SelectedFileItem {
  index: number;
  name: string;
  extension: string;
  sizeLabel: string;
}

interface ComparisonListItem {
  id: string;
  title: string;
  date: Date | null;
  activitySummaries: ComparisonActivitySummary[];
  devicesLabel: string;
  activityTypesLabel: string;
  activityTypesTitle: string;
  distanceTitle: string;
  ascentTitle: string;
  descentTitle: string;
  gnssBenchmark: ComparisonBenchmarkMetricCell;
  heartRateBenchmark: ComparisonBenchmarkMetricCell;
  altitudeBenchmark: ComparisonBenchmarkMetricCell;
  description: string;
  benchmarkReviewTags: string[];
  benchmarkReviewTagsTitle: string;
  deviceFilterValues: string[];
  activityTypeFilterValues: string[];
  tagFilterValues: string[];
  sourceFilesCount: number | null;
  sourceFilesLabel: string;
  sourceFilesTitle: string;
  hasReport: boolean;
  reportCount: number;
  reportLabel: string;
  reportTitle: string;
  benchmarkPairLabel: string;
  benchmarkPairTitle: string;
  statusLabel: string;
  statusTitle: string;
  statusIcon: string;
  statusState: ComparisonStatusState;
  filterText: string;
  event: AppEventInterface;
}

type ComparisonStatusState = 'draft' | 'ready' | 'error';

interface ComparisonBenchmarkFailure {
  type: 'no_overlap';
  message: string;
}

interface ComparisonActivitySummary {
  id: string;
  deviceLabel: string;
  deviceColorKey: string;
  deviceColor: string;
  automaticDeviceColor: string;
  activityTypeLabel: string;
  activityTypeIconValue: string;
  distanceLabel: string;
  ascentLabel: string;
  descentLabel: string;
  filterText: string;
}

interface ComparisonBenchmarkMetricCell {
  lines: ComparisonBenchmarkMetricLine[];
  sortValue: number | null;
  title: string;
  isPlaceholder: boolean;
  canRerunReport: boolean;
  color: string | null;
  severityLabel: string;
  dominantLineLabel: string | null;
}

interface ComparisonBenchmarkMetricLine {
  label: string;
  value: string;
  isPlaceholder: boolean;
}

type ComparisonSortColumn = SavedBenchmarkComparisonSortColumn;
type ComparisonDeviceSource = 'report' | 'legacy-report' | 'metadata' | 'activity';

interface ComparisonSortState {
  active: ComparisonSortColumn;
  direction: Exclude<SortDirection, ''>;
}

interface ComparisonPageState {
  pageIndex: number;
  pageSize: number;
}

interface ComparisonFilterOption {
  value: string;
  label: string;
}

type ComparisonEventFields = AppEventInterface & {
  sourceFilesCount?: number;
  comparisonTitle?: string;
  benchmarkResult?: unknown;
};

const MAX_COMPARISON_FILES = 10;
const DEFAULT_COMPARISON_PAGE_SIZE = 25;
const COMPARISON_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const MISSING_BENCHMARK_REPORT_TOOLTIP = 'No benchmark report yet. Run the benchmark report from this row to generate GNSS, heart-rate, and altitude metrics.';
const PASSIVE_TABLE_TOOLTIP_MEDIA_QUERIES = ['(pointer: coarse)', '(hover: none)', AppBreakpoints.Handset] as const;

@Component({
  selector: 'app-tools-compare-page',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './tools-compare-page.component.html',
  styleUrls: ['./tools-compare-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsComparePageComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private breakpointObserver = inject(BreakpointObserver);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private authService = inject(AppAuthService);
  private analyticsService = inject(AppAnalyticsService);
  private eventService = inject(AppEventService);
  private comparisonService = inject(AppToolsComparisonService);
  private eventColorService = inject(AppEventColorService);
  private deviceColorPreferenceService = inject(AppDeviceColorPreferenceService);
  private benchmarkFlowService = inject(AppBenchmarkFlowService);
  private hapticsService = inject(AppHapticsService);
  private processingService = inject(AppProcessingService);
  private benchmarkReviewService = inject(BenchmarkReviewService);
  private logger = inject(LoggerService);
  private readonly comparisonSelection = new SelectionModel<string>(true, []);
  private readonly comparisonRowActivationState: TableRowActivationState = createTableRowActivationState();

  readonly selectedFiles = signal<File[]>([]);
  readonly comparisonTitle = signal('');
  readonly isCreating = signal(false);
  readonly currentUser = signal<User | null>(null);
  readonly comparisons = signal<AppEventInterface[]>([]);
  readonly comparisonTotalCount = signal(0);
  readonly isLoadingComparisons = signal(false);
  readonly deletingEventID = signal<string | null>(null);
  readonly bulkActionInProgress = signal(false);
  readonly savingDescriptionEventID = signal<string | null>(null);
  readonly editingDescriptionEventID = signal<string | null>(null);
  readonly benchmarkingEventID = signal<string | null>(null);
  readonly benchmarkFailureByEventID = signal<Record<string, ComparisonBenchmarkFailure>>({});
  readonly passiveComparisonTableTooltipsDisabled = signal(false);
  readonly descriptionDrafts = signal<Record<string, string>>({});
  readonly comparisonFilter = signal('');
  readonly comparisonDeviceFilter = signal('');
  readonly comparisonActivityTypeFilter = signal('');
  readonly comparisonTagFilter = signal('');
  readonly selectedComparisonIDs = signal<string[]>([]);
  readonly comparisonSort = signal<ComparisonSortState>({ active: 'date', direction: 'desc' });
  readonly comparisonPage = signal<ComparisonPageState>({
    pageIndex: 0,
    pageSize: DEFAULT_COMPARISON_PAGE_SIZE,
  });
  readonly comparisonPageSizeOptions = COMPARISON_PAGE_SIZE_OPTIONS;
  readonly displayedComparisonColumns = [
    'select',
    'date',
    'title',
    'tags',
    'devices',
    'activityType',
    'distance',
    'ascent',
    'descent',
    'gnss',
    'heartRate',
    'altitude',
    'description',
    'sourceFiles',
    'status',
    'reports',
    'actions',
  ];
  readonly comparisonHeaderDataTypes = {
    date: 'Start Date',
    title: 'Name',
    devices: 'Device Names',
    activityType: DataActivityTypes.type,
    distance: DataDistance.type,
    ascent: DataAscent.type,
    descent: DataDescent.type,
    heartRate: 'Average Heart Rate',
    altitude: 'Average Altitude',
    description: 'Description',
  } as const;
  readonly comparisonHeaderMaterialIcons = {
    gnss: 'satellite_alt',
    sourceFiles: 'attach_file',
    status: 'task_alt',
    reports: 'analytics',
    tags: 'sell',
    actions: 'more_horiz',
  } as const;
  private readonly resolvedAuthState = this.route.snapshot.data['toolsCompareAuth'] as ToolsCompareAuthResolverData | undefined;
  private readonly initialTabIndex = this.route.snapshot.data['defaultTab'] === 'saved' ? 1 : 0;
  readonly guestSignInRedirectUrl = this.initialTabIndex === 1 ? '/tools/compare/saved' : '/tools/compare';
  readonly showSavedComparisonsFirst = this.initialTabIndex === 1;
  private readonly hydratingActivitySummaryEventIDs = new Set<string>();
  private readonly hydratedActivitySummaryEventIDs = new Set<string>();
  private loadedComparisonPages = new Map<number, AppEventInterface[]>();
  private comparisonPageCursors = new Map<number, EventQueryCursor | null>([[0, null]]);
  private comparisonLoadGeneration = 0;
  private lastLoggedFilterActive = false;
  readonly authResolved = signal<boolean>(this.resolvedAuthState?.authResolved ?? true);
  readonly firebaseSignedIn = signal(this.resolvedAuthState?.signedIn === true);
  readonly isAuthResolving = computed(() => !this.authResolved());
  readonly isSignedInProfileLoading = computed(() =>
    this.authResolved()
    && this.firebaseSignedIn()
    && !this.currentUser(),
  );
  readonly showGuestExperience = computed(() =>
    this.authResolved()
    && !this.firebaseSignedIn()
    && !this.currentUser(),
  );
  readonly showSignedInWorkspace = computed(() =>
    this.firebaseSignedIn()
    || !!this.currentUser(),
  );
  readonly uploadControlsDisabled = computed(() => this.isCreating() || this.isSignedInProfileLoading());
  readonly isSavedComparisonsLoading = computed(() => this.isSignedInProfileLoading() || this.isLoadingComparisons());

  readonly selectedFileItems = computed<SelectedFileItem[]>(() =>
    this.selectedFiles().map((file, index) => ({
      index,
      name: file.name || `File ${index + 1}`,
      extension: this.resolveExtensionFromFilename(file.name).toUpperCase(),
      sizeLabel: this.formatFileSize(file.size),
    })),
  );

  readonly validationMessage = computed(() => {
    const files = this.selectedFiles();
    if (files.length === 0) {
      return null;
    }
    if (files.length === 1) {
      return 'Add one more file to create a comparison.';
    }
    return this.comparisonService.validateFiles(files);
  });

  readonly canCreateComparison = computed(() =>
    !!this.currentUser()
    && !this.isCreating()
    && this.selectedFiles().length >= 2
    && !this.validationMessage(),
  );

  readonly comparisonItems = computed<ComparisonListItem[]>(() =>
    this.comparisons()
      .map((event) => this.toComparisonListItem(event))
      .filter((item): item is ComparisonListItem => !!item),
  );

  readonly filteredComparisonItems = computed<ComparisonListItem[]>(() => {
    const filter = this.comparisonFilter().trim().toLowerCase();
    const deviceFilter = this.comparisonDeviceFilter();
    const activityTypeFilter = this.comparisonActivityTypeFilter();
    const tagFilter = this.comparisonTagFilter();
    const items = this.comparisonItems();
    if (!filter && !deviceFilter && !activityTypeFilter && !tagFilter) {
      return items;
    }

    return items.filter((item) => {
      if (filter && !item.filterText.includes(filter)) {
        return false;
      }
      if (deviceFilter && !item.deviceFilterValues.includes(deviceFilter)) {
        return false;
      }
      if (activityTypeFilter && !item.activityTypeFilterValues.includes(activityTypeFilter)) {
        return false;
      }
      if (tagFilter && !item.tagFilterValues.includes(tagFilter)) {
        return false;
      }
      return true;
    });
  });

  readonly sortedComparisonItems = computed<ComparisonListItem[]>(() => {
    return this.filteredComparisonItems();
  });

  readonly comparisonDeviceColorItems = computed<DeviceColorPreferenceDialogDevice[]>(() => {
    const deviceByKey = new Map<string, DeviceColorPreferenceDialogDevice>();

    for (const item of this.comparisonItems()) {
      for (const summary of item.activitySummaries) {
        if (!summary.deviceColorKey || deviceByKey.has(summary.deviceColorKey)) {
          continue;
        }

        deviceByKey.set(summary.deviceColorKey, {
          key: summary.deviceColorKey,
          label: summary.deviceLabel,
          automaticColor: summary.automaticDeviceColor,
        });
      }
    }

    Object.keys(this.deviceColorPreferenceService.deviceColorByName()).forEach((deviceKey) => {
      if (deviceByKey.has(deviceKey)) {
        return;
      }

      deviceByKey.set(deviceKey, {
        key: deviceKey,
        label: this.formatNormalizedDeviceName(deviceKey),
        automaticColor: AppColors.Blue,
      });
    });

    return Array.from(deviceByKey.values());
  });

  readonly comparisonDeviceFilterOptions = computed<ComparisonFilterOption[]>(() =>
    this.buildComparisonFilterOptions(this.comparisonItems().flatMap(item => item.deviceFilterValues)),
  );

  readonly comparisonActivityTypeFilterOptions = computed<ComparisonFilterOption[]>(() =>
    this.buildComparisonFilterOptions(this.comparisonItems().flatMap(item => item.activityTypeFilterValues)),
  );

  readonly comparisonTagFilterOptions = computed<ComparisonFilterOption[]>(() =>
    this.buildComparisonFilterOptions(this.comparisonItems().flatMap(item => item.tagFilterValues)),
  );

  readonly selectedComparisonCount = computed(() => this.selectedComparisonIDs().length);
  readonly selectedComparisonIDSet = computed(() => new Set(this.selectedComparisonIDs()));
  readonly allVisibleComparisonsSelected = computed(() => {
    const visibleItems = this.paginatedComparisonItems();
    const selectedIDs = this.selectedComparisonIDSet();
    return visibleItems.length > 0
      && visibleItems.every(item => selectedIDs.has(item.id));
  });
  readonly visibleComparisonSelectionIndeterminate = computed(() => {
    const visibleItems = this.paginatedComparisonItems();
    const selectedIDs = this.selectedComparisonIDSet();
    const visibleSelectedCount = visibleItems.filter(item => selectedIDs.has(item.id)).length;
    return visibleSelectedCount > 0 && visibleSelectedCount < visibleItems.length;
  });

  readonly paginatedComparisonItems = computed<ComparisonListItem[]>(() => {
    const page = this.comparisonPage();
    const start = page.pageIndex * page.pageSize;
    return this.sortedComparisonItems().slice(start, start + page.pageSize);
  });

  private readonly hydrateVisibleComparisonActivitySummaries = effect(() => {
    const user = this.currentUser();
    if (!user) {
      return;
    }

    const eventIDs = this.paginatedComparisonItems()
      .filter(item => this.shouldHydrateComparisonActivitySummaryRow(item))
      .map(item => item.id)
      .filter(eventID => !this.hydratedActivitySummaryEventIDs.has(eventID) && !this.hydratingActivitySummaryEventIDs.has(eventID));

    if (eventIDs.length > 0) {
      void this.hydrateMissingActivitySummaryRows(user, eventIDs);
    }
  });

  readonly filteredComparisonCount = computed(() => this.filteredComparisonItems().length);
  readonly comparisonPaginatorLength = computed(() => {
    if (this.isComparisonFilterActive()) {
      return this.filteredComparisonCount();
    }
    return Math.max(this.comparisonTotalCount(), this.comparisonItems().length);
  });
  readonly comparisonResultSummary = computed(() => {
    const total = Math.max(this.comparisonTotalCount(), this.comparisonItems().length);
    const loaded = this.comparisonItems().length;
    const filtered = this.filteredComparisonCount();
    if (loaded === 0 && total === 0) {
      return 'No comparisons';
    }
    if (this.isComparisonFilterActive()) {
      return `${filtered} of ${loaded} loaded comparison${loaded === 1 ? '' : 's'}`;
    }
    if (loaded >= total) {
      return `${total} comparison${total === 1 ? '' : 's'}`;
    }
    return `${loaded} of ${total} loaded`;
  });

  ngOnInit(): void {
    this.breakpointObserver
      .observe(PASSIVE_TABLE_TOOLTIP_MEDIA_QUERIES)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(result => {
        if (result.matches === this.passiveComparisonTableTooltipsDisabled()) {
          return;
        }
        this.passiveComparisonTableTooltipsDisabled.set(result.matches);
      });

    this.authService.user$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((user) => {
        const previousUserID = this.currentUser()?.uid ?? null;
        const nextUserID = user?.uid ?? null;
        const authScopeChanged = previousUserID !== nextUserID;

        this.authResolved.set(true);
        this.firebaseSignedIn.set(!!user);
        this.currentUser.set(user);

        if (authScopeChanged) {
          this.resetComparisonData();
        }
        if (!user || (previousUserID && previousUserID !== nextUserID)) {
          this.selectedFiles.set([]);
          this.comparisonTitle.set('');
        }
        if (user && (authScopeChanged || this.comparisons().length === 0)) {
          void this.loadInitialComparisonPage(user);
        }
      });
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!this.currentUser()) {
      this.hapticsService.warning();
      input.value = '';
      return;
    }

    const files = Array.from(input.files || []);
    const summary = this.addFiles(files);
    if (summary) {
      this.triggerFileSelectionHaptic(summary);
      this.analyticsService.logToolCompareFileSelection(summary);
    }
    input.value = '';
  }

  removeFile(index: number): void {
    if (this.isCreating()) {
      return;
    }

    const files = this.selectedFiles();
    if (index < 0 || index >= files.length) {
      return;
    }

    this.hapticsService.selection();
    this.selectedFiles.set(files.filter((_file, fileIndex) => fileIndex !== index));
  }

  clearFiles(): void {
    if (this.isCreating()) {
      return;
    }

    if (this.selectedFiles().length === 0) {
      return;
    }

    this.hapticsService.selection();
    this.selectedFiles.set([]);
  }

  updateTitle(value: string): void {
    if (this.isCreating()) {
      return;
    }

    this.comparisonTitle.set(value);
  }

  updateComparisonFilter(value: string): void {
    if (this.bulkActionInProgress()) {
      return;
    }

    const wasFilterActive = this.isComparisonFilterActive();
    this.comparisonFilter.set(value);
    this.resetComparisonPage();
    this.reconcileComparisonSelectionWithItems(this.filteredComparisonItems());
    if (this.isComparisonFilterActive() !== wasFilterActive) {
      this.hapticsService.selection();
      this.analyticsService.logToolCompareSavedAction('filter', {
        status: this.isComparisonFilterActive() ? 'applied' : 'cleared',
        filterActive: this.isComparisonFilterActive(),
        resultCount: this.filteredComparisonCount(),
      });
      this.lastLoggedFilterActive = this.isComparisonFilterActive();
    }
  }

  updateComparisonDeviceFilter(value: string): void {
    if (this.bulkActionInProgress()) {
      return;
    }

    if (this.comparisonDeviceFilter() === value) {
      return;
    }

    this.comparisonDeviceFilter.set(value);
    this.applyComparisonFacetFilterChange();
  }

  updateComparisonActivityTypeFilter(value: string): void {
    if (this.bulkActionInProgress()) {
      return;
    }

    if (this.comparisonActivityTypeFilter() === value) {
      return;
    }

    this.comparisonActivityTypeFilter.set(value);
    this.applyComparisonFacetFilterChange();
  }

  updateComparisonTagFilter(value: string): void {
    if (this.bulkActionInProgress()) {
      return;
    }

    if (this.comparisonTagFilter() === value) {
      return;
    }

    this.comparisonTagFilter.set(value);
    this.applyComparisonFacetFilterChange();
  }

  async onComparisonSortChange(sort: Sort): Promise<void> {
    if (this.bulkActionInProgress()) {
      return;
    }

    let active: ComparisonSortColumn = 'date';
    let requestedDirection: SortDirection = '';
    if (this.isComparisonSortColumn(sort.active)) {
      active = sort.active;
      requestedDirection = sort.direction;
    }
    const direction = (requestedDirection || (active === 'date' ? 'desc' : 'asc')) as Exclude<SortDirection, ''>;
    const previousSort = this.comparisonSort();
    const nextSort: ComparisonSortState = { active, direction };

    if (previousSort.active === nextSort.active && previousSort.direction === nextSort.direction) {
      return;
    }

    this.comparisonSort.set(nextSort);
    const user = this.currentUser();
    if (user) {
      await this.loadInitialComparisonPage(user);
    } else {
      this.resetComparisonPage();
    }

    this.hapticsService.selection();
    this.analyticsService.logToolCompareSavedAction('sort', {
      sortColumn: active,
      sortDirection: direction,
      filterActive: this.isComparisonFilterActive(),
      resultCount: this.filteredComparisonCount(),
    });
  }

  async onComparisonPageChange(event: PageEvent): Promise<void> {
    if (this.bulkActionInProgress()) {
      return;
    }

    const currentPage = this.comparisonPage();
    const pageSizeChanged = currentPage.pageSize !== event.pageSize;

    if (pageSizeChanged) {
      this.comparisonPage.set({
        pageIndex: 0,
        pageSize: event.pageSize,
      });
      const user = this.currentUser();
      if (user) {
        await this.loadInitialComparisonPage(user);
      }
    } else {
      const pageReady = await this.ensureComparisonPageLoaded(event.pageIndex);
      if (!pageReady) {
        this.hapticsService.warning();
        return;
      }
      this.comparisonPage.set({
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      });
    }

    this.hapticsService.selection();
    this.analyticsService.logToolCompareSavedAction('page', {
      pageIndex: pageSizeChanged ? 0 : event.pageIndex,
      pageSize: event.pageSize,
      filterActive: this.isComparisonFilterActive(),
      resultCount: this.filteredComparisonCount(),
    });
  }

  trackComparisonRow(_index: number, item: ComparisonListItem): string {
    return item.id;
  }

  toggleComparisonSelection(item: ComparisonListItem, checked: boolean): void {
    if (this.bulkActionInProgress()) {
      return;
    }

    if (checked) {
      this.comparisonSelection.select(item.id);
    } else {
      this.comparisonSelection.deselect(item.id);
    }
    this.syncSelectedComparisonIDs();
    this.hapticsService.selection();
  }

  toggleVisibleComparisonSelection(checked: boolean): void {
    if (this.bulkActionInProgress()) {
      return;
    }

    const visibleIDs = this.paginatedComparisonItems().map(item => item.id);
    if (checked) {
      this.comparisonSelection.select(...visibleIDs);
    } else {
      visibleIDs.forEach(eventID => this.comparisonSelection.deselect(eventID));
    }
    this.syncSelectedComparisonIDs();
    this.hapticsService.selection();
  }

  clearComparisonSelection(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.clearComparisonSelectionWithoutHaptic();
    this.hapticsService.selection();
  }

  startDescriptionEdit(item: ComparisonListItem): void {
    if (this.savingDescriptionEventID() || this.bulkActionInProgress()) {
      return;
    }

    this.editingDescriptionEventID.set(item.id);
    this.hapticsService.selection();
    this.analyticsService.logToolCompareSavedAction('description_edit', this.getComparisonSavedActionAnalytics(item, {
      hadDescription: !!item.description,
    }));
  }

  cancelDescriptionEdit(item: ComparisonListItem): void {
    if (this.savingDescriptionEventID() === item.id) {
      return;
    }

    this.clearDescriptionDraft(item.id);
    this.clearDescriptionEdit(item.id);
    this.hapticsService.selection();
  }

  updateDescriptionDraft(item: ComparisonListItem, value: string): void {
    if (this.savingDescriptionEventID() === item.id) {
      return;
    }

    this.descriptionDrafts.update((drafts) => {
      const nextDrafts = { ...drafts };
      if (value === item.description) {
        delete nextDrafts[item.id];
      } else {
        nextDrafts[item.id] = value;
      }
      return nextDrafts;
    });
  }

  async saveDescription(item: ComparisonListItem): Promise<void> {
    if (this.savingDescriptionEventID()) {
      return;
    }

    const user = this.currentUser();
    if (!user) {
      this.clearDescriptionEdit(item.id);
      this.hapticsService.warning();
      return;
    }

    const nextDescription = this.descriptionDrafts()[item.id] ?? item.description;
    if (nextDescription === item.description) {
      this.clearDescriptionDraft(item.id);
      this.clearDescriptionEdit(item.id);
      this.hapticsService.selection();
      return;
    }

    this.savingDescriptionEventID.set(item.id);
    try {
      await this.eventService.updateEventProperties(user, item.id, {
        description: nextDescription,
      });
      this.updateComparisonEventInLoadedRows(item.id, (event) => {
        event.description = nextDescription;
        return event;
      });
      this.clearDescriptionDraft(item.id);
      this.clearDescriptionEdit(item.id);
      this.snackBar.open('Description saved.', undefined, { duration: 2000 });
      this.hapticsService.success();
      this.analyticsService.logToolCompareSavedAction('description_save', this.getComparisonSavedActionAnalytics(item, {
        status: 'success',
        hadDescription: !!item.description,
      }));
    } catch {
      this.clearDescriptionDraft(item.id);
      this.clearDescriptionEdit(item.id);
      this.snackBar.open('Could not save description.', undefined, { duration: 3000 });
      this.hapticsService.error();
      this.analyticsService.logToolCompareSavedAction('description_save', this.getComparisonSavedActionAnalytics(item, {
        status: 'failure',
        hadDescription: !!item.description,
      }));
    } finally {
      this.savingDescriptionEventID.set(null);
    }
  }

  async createComparison(): Promise<void> {
    if (this.isCreating()) {
      return;
    }

    const user = this.currentUser();
    if (!user) {
      await this.signIn('/tools/compare', 'guest_create');
      return;
    }

    const validationError = this.comparisonService.validateFiles(this.selectedFiles());
    if (validationError) {
      this.snackBar.open(validationError, undefined, { duration: 3000 });
      this.hapticsService.warning();
      this.analyticsService.logToolCompareCreate('validation_failure', {
        ...this.getComparisonCreateAnalytics(),
        errorCategory: this.resolveComparisonErrorCategory(validationError),
      });
      return;
    }

    this.isCreating.set(true);
    this.hapticsService.selection();
    this.analyticsService.logToolCompareCreate('start', this.getComparisonCreateAnalytics());
    try {
      const result = await this.comparisonService.createComparison(
        this.selectedFiles(),
        this.comparisonTitle(),
      );
      this.analyticsService.logToolCompareCreate('success', {
        ...this.getComparisonCreateAnalytics(),
        alreadyExists: result.alreadyExists === true,
      });
      this.selectedFiles.set([]);
      this.comparisonTitle.set('');
      this.snackBar.open(result.alreadyExists ? 'Existing comparison opened.' : 'Comparison created.', undefined, { duration: 2000 });
      this.hapticsService.success();
      await this.router.navigate(['/user', user.uid, 'event', result.eventId], {
        queryParams: { benchmark: '1' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create comparison.';
      this.snackBar.open(message, 'Close', { duration: 5000 });
      this.hapticsService.error();
      this.analyticsService.logToolCompareCreate('failure', {
        ...this.getComparisonCreateAnalytics(),
        errorCategory: this.resolveComparisonErrorCategory(error),
      });
    } finally {
      this.isCreating.set(false);
    }
  }

  async openComparison(item: ComparisonListItem, benchmark: boolean): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      await this.signIn('/tools/compare/saved', 'saved_action');
      return;
    }

    if (this.bulkActionInProgress() || (benchmark && this.benchmarkingEventID())) {
      return;
    }

    this.hapticsService.selection();
    this.analyticsService.logToolCompareSavedAction(
      benchmark ? (item.hasReport ? 'open_report' : 'run_report') : 'open_details',
      this.getComparisonSavedActionAnalytics(item),
    );

    if (benchmark) {
      this.benchmarkingEventID.set(item.id);
      try {
        await this.openBenchmarkFlowFromComparison(item, user);
      } catch (error) {
        this.logger.warn('[ToolsComparePageComponent] Could not open benchmark flow.', {
          eventID: item.id,
          error,
        });
        this.snackBar.open('Could not open benchmark report.', undefined, { duration: 3000 });
        this.hapticsService.error();
      } finally {
        if (this.benchmarkingEventID() === item.id) {
          this.benchmarkingEventID.set(null);
        }
      }
      return;
    }

    await this.router.navigate(['/user', user.uid, 'event', item.id], {
      queryParams: undefined,
    });
  }

  onComparisonRowPointerDown(event: PointerEvent): void {
    beginTableRowPointerTracking(this.comparisonRowActivationState, event);
  }

  onComparisonRowPointerMove(event: PointerEvent): void {
    updateTableRowPointerTracking(this.comparisonRowActivationState, event);
  }

  onComparisonRowPointerUp(event: PointerEvent): void {
    endTableRowPointerTracking(this.comparisonRowActivationState, event);
  }

  onComparisonRowPointerCancel(event: PointerEvent): void {
    cancelTableRowPointerTracking(this.comparisonRowActivationState, event);
  }

  onComparisonRowClick(item: ComparisonListItem, event: MouseEvent): void {
    if (!shouldActivateTableRowFromClick(this.comparisonRowActivationState, event)) {
      return;
    }

    void this.openComparison(item, false);
  }

  onComparisonRowKeydown(item: ComparisonListItem, event: Event): void {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }

    if (!shouldActivateTableRowFromKeyboard(event)) {
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
    }
    void this.openComparison(item, false);
  }

  async openBenchmarkFromMetricCell(
    item: ComparisonListItem,
    cell?: ComparisonBenchmarkMetricCell,
  ): Promise<void> {
    if (this.bulkActionInProgress()) {
      return;
    }

    if (item.hasReport && !cell?.canRerunReport) {
      return;
    }

    if (item.hasReport) {
      await this.rerunBenchmarkReport(item);
      return;
    }

    await this.openComparison(item, true);
  }

  private async rerunBenchmarkReport(item: ComparisonListItem): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      await this.signIn('/tools/compare/saved', 'saved_action');
      return;
    }

    if (this.benchmarkingEventID()) {
      return;
    }

    this.hapticsService.selection();
    this.analyticsService.logToolCompareSavedAction(
      'rerun_report',
      this.getComparisonSavedActionAnalytics(item),
    );

    this.benchmarkingEventID.set(item.id);
    try {
      await this.openBenchmarkSelectionFlowFromComparison(item, user);
    } catch (error) {
      this.logger.warn('[ToolsComparePageComponent] Could not rerun benchmark report.', {
        eventID: item.id,
        error,
      });
      this.snackBar.open('Could not rerun benchmark report.', undefined, { duration: 3000 });
      this.hapticsService.error();
    } finally {
      if (this.benchmarkingEventID() === item.id) {
        this.benchmarkingEventID.set(null);
      }
    }
  }

  private buildBenchmarkFlowConfig(item: ComparisonListItem, user: User) {
    return {
      event: item.event,
      persistEvent: item.event,
      user,
      initialSelection: this.resolveBenchmarkInitialSelection(item.event),
      hydrateStreamsForGeneration: true,
      reviewTagSuggestions: this.comparisonTagFilterOptions().map(option => option.label),
      onResult: (benchmarkResult: BenchmarkResult) => this.applyBenchmarkResultToComparisonRow(item.id, benchmarkResult),
      onEventTagsSaved: (tags: string[]) => this.applyBenchmarkReviewTagsToComparisonRow(item.id, tags),
      onGenerationStart: () => {
        this.clearBenchmarkFailureForComparison(item.id);
        this.benchmarkingEventID.set(item.id);
      },
      onGenerationComplete: (status: 'success' | 'failure', failureReason?: BenchmarkGenerationFailureReason) => {
        if (this.benchmarkingEventID() === item.id) {
          this.benchmarkingEventID.set(null);
        }
        if (status === 'success') {
          this.clearBenchmarkFailureForComparison(item.id);
          return;
        }
        if (failureReason === 'no_overlap') {
          this.setBenchmarkFailureForComparison(item.id, {
            type: 'no_overlap',
            message: BENCHMARK_NO_OVERLAP_MESSAGE,
          });
        }
        if (status === 'failure') {
          this.hapticsService.warning();
        }
      },
    };
  }

  private async openBenchmarkFlowFromComparison(item: ComparisonListItem, user: User): Promise<void> {
    const result = this.resolvePrimaryBenchmarkResult(item.event);
    const config = this.buildBenchmarkFlowConfig(item, user);

    if (result) {
      await this.benchmarkFlowService.openBenchmarkReport({
        ...config,
        result,
      });
      return;
    }

    await this.benchmarkFlowService.openBenchmarkSelectionDialog(config);
  }

  private async openBenchmarkSelectionFlowFromComparison(item: ComparisonListItem, user: User): Promise<void> {
    await this.benchmarkFlowService.openBenchmarkSelectionDialog(this.buildBenchmarkFlowConfig(item, user));
  }

  private resolveBenchmarkInitialSelection(event: AppEventInterface): ActivityInterface[] | undefined {
    const activities = event.getActivities?.() || [];
    return activities.length >= 2 ? activities.slice(0, 2) : undefined;
  }

  private applyBenchmarkResultToComparisonRow(eventID: string, benchmarkResult: BenchmarkResult): void {
    const referenceId = benchmarkResult.referenceId;
    const testId = benchmarkResult.testId;
    if (!referenceId || !testId) {
      return;
    }

    this.clearBenchmarkFailureForComparison(eventID);
    const pairKey = getBenchmarkPairKey(referenceId, testId);
    this.updateComparisonEventInLoadedRows(eventID, (event) => {
      const benchmarkResults = {
        ...(event.benchmarkResults || {}),
        [pairKey]: benchmarkResult,
      };
      event.benchmarkResults = benchmarkResults;
      event.hasBenchmark = true;
      event.benchmarkLatestAt = benchmarkResult.timestamp;
      event.benchmarkDevices = this.buildBenchmarkDeviceKeys(benchmarkResults);
      return event;
    });
    this.hapticsService.success();
  }

  private setBenchmarkFailureForComparison(eventID: string, failure: ComparisonBenchmarkFailure): void {
    this.benchmarkFailureByEventID.update(failures => ({
      ...failures,
      [eventID]: failure,
    }));
  }

  private clearBenchmarkFailureForComparison(eventID: string): void {
    this.benchmarkFailureByEventID.update((failures) => {
      if (!failures[eventID]) {
        return failures;
      }
      const nextFailures = { ...failures };
      delete nextFailures[eventID];
      return nextFailures;
    });
  }

  private applyBenchmarkReviewTagsToComparisonRow(eventID: string, tags: string[]): void {
    this.updateComparisonEventInLoadedRows(eventID, (event) => {
      event.benchmarkReviewTags = this.benchmarkReviewService.normalizeTags(tags);
      return event;
    });
  }

  async confirmDeleteSelectedComparisons(): Promise<void> {
    const user = this.currentUser();
    const selectedItems = this.getSelectedLoadedComparisonItems();
    if (
      !user
      || selectedItems.length === 0
      || this.bulkActionInProgress()
      || !!this.deletingEventID()
      || !!this.benchmarkingEventID()
      || !!this.savingDescriptionEventID()
      || !!this.editingDescriptionEventID()
    ) {
      return;
    }

    this.hapticsService.selection();
    const comparisonLabel = selectedItems.length === 1 ? 'comparison' : 'comparisons';
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: `Delete ${selectedItems.length} selected ${comparisonLabel}?`,
        message: `This removes ${selectedItems.length} selected saved benchmark ${comparisonLabel} and their source files.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmationDialogData,
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) {
      return;
    }

    this.analyticsService.logToolCompareSavedAction('delete', {
      status: 'confirmed',
      filterActive: this.isComparisonFilterActive(),
      resultCount: this.filteredComparisonCount(),
      selectedCount: selectedItems.length,
    });
    this.bulkActionInProgress.set(true);
    const jobId = this.processingService.addJob('process', 'Deleting selected comparisons...');
    this.processingService.updateJob(jobId, { status: 'processing', progress: 10 });
    const failedComparisonIDs: string[] = [];
    const deletedComparisonIDs: string[] = [];

    try {
      for (let index = 0; index < selectedItems.length; index += 1) {
        const item = selectedItems[index];
        try {
          await this.eventService.deleteAllEventData(user, item.id);
          deletedComparisonIDs.push(item.id);
        } catch (error) {
          failedComparisonIDs.push(item.id);
          this.logger.error('[ToolsComparePageComponent] Failed to delete selected comparison', { eventID: item.id }, error);
        }

        this.processingService.updateJob(jobId, {
          progress: 10 + Math.round(((index + 1) / selectedItems.length) * 80),
          details: `Deleted ${deletedComparisonIDs.length} of ${selectedItems.length}`,
        });
      }

      if (deletedComparisonIDs.length > 0) {
        this.removeComparisonEventsFromLoadedRows(deletedComparisonIDs);
        this.comparisonTotalCount.update(total => Math.max(0, total - deletedComparisonIDs.length));
        this.resetComparisonPage();
      }

      this.comparisonSelection.clear();
      this.comparisonSelection.select(...failedComparisonIDs);
      this.syncSelectedComparisonIDs();

      if (deletedComparisonIDs.length === 0) {
        this.processingService.failJob(jobId, 'No selected comparisons deleted');
        this.analyticsService.logToolCompareSavedAction('delete', {
          status: 'failure',
          filterActive: this.isComparisonFilterActive(),
          resultCount: this.filteredComparisonCount(),
          selectedCount: selectedItems.length,
          deletedCount: 0,
          failedCount: failedComparisonIDs.length,
        });
        this.snackBar.open('Could not delete selected comparisons.', undefined, { duration: 3000 });
        this.hapticsService.error();
        return;
      }

      const statusMessage = failedComparisonIDs.length > 0
        ? `Deleted ${deletedComparisonIDs.length} ${deletedComparisonIDs.length === 1 ? 'comparison' : 'comparisons'}. Failed ${failedComparisonIDs.length}.`
        : `Deleted ${deletedComparisonIDs.length} ${deletedComparisonIDs.length === 1 ? 'comparison' : 'comparisons'}.`;
      const analyticsStatus = failedComparisonIDs.length > 0 ? 'partial_success' : 'success';
      this.processingService.completeJob(jobId, statusMessage);
      this.analyticsService.logToolCompareSavedAction('delete', {
        status: analyticsStatus,
        filterActive: this.isComparisonFilterActive(),
        resultCount: this.filteredComparisonCount(),
        selectedCount: selectedItems.length,
        deletedCount: deletedComparisonIDs.length,
        failedCount: failedComparisonIDs.length,
      });
      this.snackBar.open(statusMessage, undefined, { duration: failedComparisonIDs.length > 0 ? 4000 : 2500 });
      if (failedComparisonIDs.length > 0) {
        this.hapticsService.warning();
      } else {
        this.hapticsService.success();
      }
    } catch (error) {
      this.processingService.failJob(jobId, 'Selected comparison delete failed');
      this.analyticsService.logToolCompareSavedAction('delete', {
        status: 'failure',
        filterActive: this.isComparisonFilterActive(),
        resultCount: this.filteredComparisonCount(),
        selectedCount: selectedItems.length,
        deletedCount: deletedComparisonIDs.length,
        failedCount: selectedItems.length - deletedComparisonIDs.length,
      });
      this.logger.error('[ToolsComparePageComponent] Failed to delete selected comparisons', error);
      this.snackBar.open('Could not delete selected comparisons.', undefined, { duration: 3000 });
      this.hapticsService.error();
    } finally {
      this.bulkActionInProgress.set(false);
    }
  }

  async deleteComparison(item: ComparisonListItem): Promise<void> {
    if (this.deletingEventID() || this.bulkActionInProgress()) {
      return;
    }

    const user = this.currentUser();
    if (!user) {
      return;
    }

    this.hapticsService.selection();
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Delete comparison?',
        message: 'This removes the saved benchmark event and its source files.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmationDialogData,
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) {
      return;
    }

    this.analyticsService.logToolCompareSavedAction('delete', this.getComparisonSavedActionAnalytics(item, {
      status: 'confirmed',
    }));
    this.deletingEventID.set(item.id);
    try {
      await this.eventService.deleteAllEventData(user, item.id);
      this.removeComparisonEventFromLoadedRows(item.id);
      this.comparisonTotalCount.update(total => Math.max(0, total - 1));
      this.resetComparisonPage();
      this.snackBar.open('Comparison deleted.', undefined, { duration: 2000 });
      this.hapticsService.success();
      this.analyticsService.logToolCompareSavedAction('delete', this.getComparisonSavedActionAnalytics(item, {
        status: 'success',
      }));
    } catch {
      this.snackBar.open('Could not delete comparison.', undefined, { duration: 3000 });
      this.hapticsService.error();
      this.analyticsService.logToolCompareSavedAction('delete', this.getComparisonSavedActionAnalytics(item, {
        status: 'failure',
      }));
    } finally {
      this.deletingEventID.set(null);
    }
  }

  openDeviceColorPreferencesDialog(initialDeviceKey?: string | null): void {
    if (this.bulkActionInProgress()) {
      return;
    }

    const devices = this.comparisonDeviceColorItems();
    if (devices.length === 0) {
      return;
    }

    this.hapticsService.selection();
    this.dialog.open(DeviceColorPreferencesDialogComponent, {
      width: 'min(40rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        devices,
        initialDeviceKey: initialDeviceKey || null,
      },
    });
  }

  async openBenchmarkReviewTagsDialog(item: ComparisonListItem): Promise<void> {
    if (this.bulkActionInProgress()) {
      return;
    }

    const user = this.currentUser();
    if (!user) {
      this.hapticsService.warning();
      return;
    }

    this.hapticsService.selection();
    this.analyticsService.logToolCompareSavedAction('tags_edit', this.getComparisonSavedActionAnalytics(item, {
      tagCount: item.benchmarkReviewTags.length,
    }));

    const dialogRef = this.dialog.open(BenchmarkReviewTagsDialogComponent, {
      width: 'min(34rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        title: 'Comparison tags',
        tags: item.benchmarkReviewTags,
        suggestions: this.comparisonTagFilterOptions().map(option => option.label),
        save: async (tags: string[]) => {
          const savedTags = await this.benchmarkReviewService.saveEventTags(user, item.event, tags);
          this.updateComparisonEventInLoadedRows(item.id, (event) => {
            event.benchmarkReviewTags = savedTags;
            return event;
          });
          return savedTags;
        },
      },
    });

    const savedTags = await firstValueFrom(dialogRef.afterClosed());
    if (!Array.isArray(savedTags)) {
      return;
    }

    this.snackBar.open('Tags saved.', undefined, { duration: 2000 });
    this.hapticsService.success();
    this.analyticsService.logToolCompareSavedAction('tags_save', this.getComparisonSavedActionAnalytics(item, {
      status: 'success',
      tagCount: savedTags.length,
    }));
  }

  async signIn(redirectUrl = '/tools/compare', source: ToolCompareSignInSource = 'guest_cta'): Promise<void> {
    this.hapticsService.selection();
    this.analyticsService.logToolCompareSignIn(source, redirectUrl === '/tools/compare/saved' ? 'saved' : 'compare');
    this.authService.redirectUrl = redirectUrl;
    await this.router.navigate(['/login'], { queryParams: { returnUrl: redirectUrl } });
  }

  private applyComparisonFacetFilterChange(): void {
    this.resetComparisonPage();
    this.reconcileComparisonSelectionWithItems(this.filteredComparisonItems());
    this.hapticsService.selection();
    this.analyticsService.logToolCompareSavedAction('filter', {
      status: this.isComparisonFilterActive() ? 'applied' : 'cleared',
      filterActive: this.isComparisonFilterActive(),
      resultCount: this.filteredComparisonCount(),
    });
    this.lastLoggedFilterActive = this.isComparisonFilterActive();
  }

  private async loadInitialComparisonPage(user: User): Promise<void> {
    const loadGeneration = ++this.comparisonLoadGeneration;
    this.clearComparisonPageCache();
    this.clearComparisonSelectionWithoutHaptic();
    this.comparisonTotalCount.set(0);
    this.isLoadingComparisons.set(true);

    try {
      const pageSize = this.comparisonPage().pageSize;
      const [totalCount, firstPage] = await Promise.all([
        firstValueFrom(this.comparisonService.getBenchmarkComparisonCount(user)),
        firstValueFrom(this.comparisonService.getBenchmarkComparisonPage(user, {
          pageSize,
          sort: this.comparisonSort(),
        })),
      ]);

      if (!this.isCurrentComparisonLoad(loadGeneration, user)) {
        return;
      }

      this.comparisonTotalCount.set(totalCount);
      this.storeComparisonPage(0, firstPage);
      this.comparisonPage.set({ pageIndex: 0, pageSize });
    } catch (error) {
      if (this.isCurrentComparisonLoad(loadGeneration, user)) {
        this.handleComparisonLoadError(error);
      }
    } finally {
      if (this.isCurrentComparisonLoad(loadGeneration, user)) {
        this.isLoadingComparisons.set(false);
      }
    }
  }

  private async ensureComparisonPageLoaded(targetPageIndex: number): Promise<boolean> {
    if (targetPageIndex <= 0 || this.loadedComparisonPages.has(targetPageIndex)) {
      return true;
    }

    const user = this.currentUser();
    if (!user) {
      return true;
    }

    const loadGeneration = this.comparisonLoadGeneration;
    this.isLoadingComparisons.set(true);

    try {
      const pageSize = this.comparisonPage().pageSize;
      for (let pageIndex = 1; pageIndex <= targetPageIndex; pageIndex += 1) {
        if (this.loadedComparisonPages.has(pageIndex)) {
          continue;
        }

        const cursor = this.comparisonPageCursors.get(pageIndex);
        if (!cursor) {
          return false;
        }

        const page = await firstValueFrom(this.comparisonService.getBenchmarkComparisonPage(user, {
          pageSize,
          cursor,
          sort: this.comparisonSort(),
        }));
        if (!this.isCurrentComparisonLoad(loadGeneration, user)) {
          return false;
        }

        this.storeComparisonPage(pageIndex, page);
        if (!page.hasMore) {
          return pageIndex >= targetPageIndex;
        }
      }
      return true;
    } catch (error) {
      if (this.isCurrentComparisonLoad(loadGeneration, user)) {
        this.handleComparisonLoadError(error);
      }
      return false;
    } finally {
      if (this.isCurrentComparisonLoad(loadGeneration, user)) {
        this.isLoadingComparisons.set(false);
      }
    }
  }

  private handleComparisonLoadError(error: unknown): void {
    this.isLoadingComparisons.set(false);
    this.logger.warn('[ToolsComparePageComponent] Could not load saved comparisons.', error);
    this.snackBar.open('Could not load saved comparisons.', undefined, { duration: 3000 });
  }

  private storeComparisonPage(pageIndex: number, page: SavedBenchmarkComparisonsPage): void {
    this.loadedComparisonPages.set(pageIndex, page.events);
    if (page.nextCursor) {
      this.comparisonPageCursors.set(pageIndex + 1, page.nextCursor);
    } else {
      this.comparisonPageCursors.delete(pageIndex + 1);
    }
    if (!page.hasMore) {
      this.comparisonPageCursors.delete(pageIndex + 1);
    }
    this.syncComparisonPages();
  }

  private syncComparisonPages(): void {
    const events = Array.from(this.loadedComparisonPages.entries())
      .sort(([firstPageIndex], [secondPageIndex]) => firstPageIndex - secondPageIndex)
      .flatMap(([, pageEvents]) => pageEvents);
    this.comparisons.set(events);
    this.reconcileComparisonSelectionWithItems(this.comparisonItems());
  }

  private updateComparisonEventInLoadedRows(
    eventID: string,
    updateEvent: (event: AppEventInterface) => AppEventInterface,
  ): void {
    let updatedLoadedPage = false;
    for (const [pageIndex, pageEvents] of this.loadedComparisonPages.entries()) {
      const nextPageEvents = pageEvents.map((event) => {
        if (event.getID() !== eventID) {
          return event;
        }
        updatedLoadedPage = true;
        return updateEvent(event);
      });
      this.loadedComparisonPages.set(pageIndex, nextPageEvents);
    }

    if (updatedLoadedPage) {
      this.syncComparisonPages();
      return;
    }

    this.comparisons.update(events => events.map((event) => {
      if (event.getID() !== eventID) {
        return event;
      }
      return updateEvent(event);
    }));
  }

  private removeComparisonEventFromLoadedRows(eventID: string): void {
    this.removeComparisonEventsFromLoadedRows([eventID]);
  }

  private removeComparisonEventsFromLoadedRows(eventIDs: string[]): void {
    const eventIDSet = new Set(eventIDs);
    if (eventIDSet.size === 0) {
      return;
    }

    eventIDSet.forEach(eventID => this.clearBenchmarkFailureForComparison(eventID));
    let removedLoadedPage = false;
    for (const [pageIndex, pageEvents] of this.loadedComparisonPages.entries()) {
      const nextPageEvents = pageEvents.filter(event => !eventIDSet.has(event.getID()));
      if (nextPageEvents.length !== pageEvents.length) {
        removedLoadedPage = true;
      }
      this.loadedComparisonPages.set(pageIndex, nextPageEvents);
    }

    if (removedLoadedPage) {
      this.syncComparisonPages();
      eventIDs.forEach(eventID => this.comparisonSelection.deselect(eventID));
      this.syncSelectedComparisonIDs();
      return;
    }

    this.comparisons.update(events => events.filter(event => !eventIDSet.has(event.getID())));
    eventIDs.forEach(eventID => this.comparisonSelection.deselect(eventID));
    this.syncSelectedComparisonIDs();
  }

  private clearComparisonPageCache(): void {
    this.loadedComparisonPages = new Map<number, AppEventInterface[]>();
    this.comparisonPageCursors = new Map<number, EventQueryCursor | null>([[0, null]]);
  }

  private resetComparisonData(): void {
    this.comparisonLoadGeneration += 1;
    this.clearComparisonPageCache();
    this.comparisons.set([]);
    this.comparisonTotalCount.set(0);
    this.descriptionDrafts.set({});
    this.editingDescriptionEventID.set(null);
    this.benchmarkingEventID.set(null);
    this.benchmarkFailureByEventID.set({});
    this.comparisonFilter.set('');
    this.comparisonDeviceFilter.set('');
    this.comparisonActivityTypeFilter.set('');
    this.comparisonTagFilter.set('');
    this.clearComparisonSelectionWithoutHaptic();
    this.lastLoggedFilterActive = false;
    this.hydratingActivitySummaryEventIDs.clear();
    this.hydratedActivitySummaryEventIDs.clear();
    this.isLoadingComparisons.set(false);
    this.resetComparisonPage();
  }

  private isCurrentComparisonLoad(loadGeneration: number, user: User): boolean {
    return this.comparisonLoadGeneration === loadGeneration && this.currentUser()?.uid === user.uid;
  }

  private getSelectedLoadedComparisonItems(): ComparisonListItem[] {
    const selectedIDs = this.selectedComparisonIDSet();
    return this.comparisonItems().filter(item => selectedIDs.has(item.id));
  }

  private reconcileComparisonSelectionWithItems(items: ComparisonListItem[]): void {
    const visibleIDs = new Set(items.map(item => item.id));
    let changed = false;
    [...this.comparisonSelection.selected].forEach((eventID) => {
      if (!visibleIDs.has(eventID)) {
        this.comparisonSelection.deselect(eventID);
        changed = true;
      }
    });

    if (changed || this.selectedComparisonIDs().length !== this.comparisonSelection.selected.length) {
      this.syncSelectedComparisonIDs();
    }
  }

  private syncSelectedComparisonIDs(): void {
    this.selectedComparisonIDs.set([...this.comparisonSelection.selected]);
  }

  private clearComparisonSelectionWithoutHaptic(): void {
    this.comparisonSelection.clear();
    this.syncSelectedComparisonIDs();
  }

  private getComparisonCreateAnalytics(): ToolCompareCreateAnalytics {
    return {
      fileCount: this.selectedFiles().length,
      hasCustomTitle: this.comparisonTitle().trim().length > 0,
    };
  }

  private getComparisonSavedActionAnalytics(
    item: ComparisonListItem,
    overrides: ToolCompareSavedActionAnalytics = {},
  ): ToolCompareSavedActionAnalytics {
    return {
      hasReport: item.hasReport,
      reportCount: item.reportCount,
      filterActive: this.isComparisonFilterActive(),
      resultCount: this.filteredComparisonCount(),
      ...overrides,
    };
  }

  private isComparisonFilterActive(): boolean {
    return this.comparisonFilter().trim().length > 0
      || this.comparisonDeviceFilter().length > 0
      || this.comparisonActivityTypeFilter().length > 0
      || this.comparisonTagFilter().length > 0;
  }

  private resolveComparisonErrorCategory(error: unknown): ToolCompareErrorCategory {
    const message = (error instanceof Error ? error.message : `${error ?? ''}`).toLowerCase();
    if (message.includes('select at least')) {
      return 'too_few_files';
    }
    if (message.includes('up to') || message.includes('at once')) {
      return 'too_many_files';
    }
    if (message.includes('only fit') || message.includes('unsupported') || message.includes('format')) {
      return 'unsupported_format';
    }
    if (message.includes('duplicate')) {
      return 'duplicate_source';
    }
    if (message.includes('empty')) {
      return 'empty_file';
    }
    if (message.includes('too large') || message.includes('larger than')) {
      return 'file_size';
    }
    if (message.includes('limit reached') || message.includes('quota')) {
      return 'quota';
    }
    if (message.includes('authenticated') || message.includes('authorized') || message.includes('sign in')) {
      return 'auth';
    }
    if (message.includes('app check') || message.includes('appcheck')) {
      return 'app_check';
    }
    if (message.includes('network') || message.includes('failed to fetch') || message.includes('temporarily unavailable')) {
      return 'network';
    }
    return 'unknown';
  }

  private triggerFileSelectionHaptic(summary: ToolCompareFileSelectionAnalytics): void {
    if (summary.acceptedCount > 0 && summary.rejectedCount === 0 && !summary.limitReached) {
      this.hapticsService.success();
      return;
    }

    this.hapticsService.warning();
  }

  private addFiles(files: File[]): ToolCompareFileSelectionAnalytics | null {
    if (this.isCreating() || !this.currentUser() || !files.length) {
      return null;
    }

    const nextFiles = [...this.selectedFiles()];
    const acceptedFileTypes: ToolCompareFileType[] = [];
    const rejectedNames: string[] = [];
    const previousFileCount = nextFiles.length;
    const compressedCount = files
      .map(file => this.resolveExtensionFromFilename(file.name))
      .filter(extension => extension.endsWith('.gz')).length;
    let rejectedForLimit = false;

    for (const file of files) {
      if (nextFiles.length >= MAX_COMPARISON_FILES) {
        rejectedForLimit = true;
        continue;
      }

      const extension = this.resolveExtensionFromFilename(file.name);
      const baseExtension = extension.endsWith('.gz') ? extension.slice(0, -3) : extension;
      if (!this.isToolCompareFileType(baseExtension)) {
        rejectedNames.push(file.name || 'Selected file');
        continue;
      }

      nextFiles.push(file);
      acceptedFileTypes.push(baseExtension);
    }

    this.selectedFiles.set(nextFiles);
    if (rejectedForLimit) {
      this.snackBar.open(`You can compare up to ${MAX_COMPARISON_FILES} files at once.`, undefined, { duration: 3000 });
    } else if (rejectedNames.length > 0) {
      this.snackBar.open('Only FIT, GPX, and TCX files are supported.', undefined, { duration: 3000 });
    }

    const acceptedCount = nextFiles.length - previousFileCount;
    return {
      selectedCount: files.length,
      acceptedCount,
      rejectedCount: files.length - acceptedCount,
      fileCountAfterSelection: nextFiles.length,
      fileTypes: acceptedFileTypes,
      compressedCount,
      limitReached: rejectedForLimit,
    };
  }

  private isToolCompareFileType(extension: string): extension is ToolCompareFileType {
    return extension === 'fit' || extension === 'gpx' || extension === 'tcx';
  }

  private async hydrateMissingActivitySummaryRows(user: User, eventIDs: string[]): Promise<void> {
    eventIDs.forEach(eventID => this.hydratingActivitySummaryEventIDs.add(eventID));

    try {
      const activitiesByEvent = await firstValueFrom(this.eventService.getActivitiesOnceByEventsWithOptions(
        user,
        eventIDs,
        { preferCache: true, warmServer: false },
      ));

      eventIDs.forEach((eventID) => {
        const activities = activitiesByEvent.get(eventID) || [];
        if (!activities.length) {
          return;
        }

        this.updateComparisonEventInLoadedRows(eventID, (event) => {
          if ((event.getActivities?.() || []).length > 0) {
            return event;
          }
          return this.attachActivitiesToEvent(event, activities);
        });
      });
    } catch (error) {
      this.logger.warn('[ToolsComparePageComponent] Could not hydrate comparison activity summaries.', { eventIDs, error });
    } finally {
      eventIDs.forEach((eventID) => {
        this.hydratedActivitySummaryEventIDs.add(eventID);
        this.hydratingActivitySummaryEventIDs.delete(eventID);
      });
    }
  }

  private shouldHydrateComparisonActivitySummaryRow(item: ComparisonListItem): boolean {
    if (this.hydratedActivitySummaryEventIDs.has(item.id) || this.hydratingActivitySummaryEventIDs.has(item.id)) {
      return false;
    }

    const activities = item.event.getActivities?.() || [];
    if (activities.length > 0) {
      return false;
    }

    if (item.activitySummaries.length > 0) {
      return false;
    }

    if (item.hasReport) {
      return true;
    }

    return item.devicesLabel === 'Devices unknown';
  }

  private attachActivitiesToEvent(event: AppEventInterface, activities: ActivityInterface[]): AppEventInterface {
    const mutableEvent = event as AppEventInterface & {
      clearActivities?: () => unknown;
      addActivities?: (activities: ActivityInterface[]) => unknown;
      activities?: ActivityInterface[];
      getActivities?: () => ActivityInterface[];
    };

    if (typeof mutableEvent.clearActivities === 'function') {
      mutableEvent.clearActivities();
    }
    if (typeof mutableEvent.addActivities === 'function') {
      mutableEvent.addActivities(activities);
      return event;
    }

    mutableEvent.activities = activities;
    mutableEvent.getActivities = () => mutableEvent.activities || [];
    return event;
  }

  private toComparisonListItem(event: AppEventInterface): ComparisonListItem | null {
    const eventID = event.getID();
    if (!eventID) {
      return null;
    }

    const comparisonEvent = event as ComparisonEventFields;
    const benchmarkResults = event.benchmarkResults || {};
    const savedReportCount = Object.keys(benchmarkResults).length;
    const reportCount = savedReportCount || (comparisonEvent.benchmarkResult ? 1 : 0);
    const hasReport = reportCount > 0;
    const description = typeof event.description === 'string' ? event.description : '';
    const benchmarkReviewTags = this.benchmarkReviewService.getEventTags(event);
    const benchmarkReviewTagsTitle = benchmarkReviewTags.length > 0
      ? benchmarkReviewTags.join('\n')
      : 'Add reviewer tags for this comparison.';
    const sourceFilesCount = typeof comparisonEvent.sourceFilesCount === 'number'
      ? comparisonEvent.sourceFilesCount
      : this.getOriginalFilesCount(event);
    const sourceFilesLabel = this.formatCountLabel(sourceFilesCount, 'file', 'Files unknown');
    const sourceFilesTitle = this.buildSourceFilesTitle(event, sourceFilesLabel);
    const activities = event.getActivities?.() || [];
    const activitySummaries = this.buildComparisonActivitySummaries(activities);
    const deviceNames = this.resolveComparisonDeviceNames(event, activities);
    const devicesLabel = deviceNames.length > 0 ? deviceNames.join(', ') : 'Devices unknown';
    const deviceFilterValues = deviceNames;
    const activityTypeLabels = this.getDistinctLabels(activitySummaries.map(summary => summary.activityTypeLabel));
    const activityTypeFilterValues = activityTypeLabels;
    const activityTypesLabel = activityTypeLabels.length > 0
      ? activityTypeLabels.join(', ')
      : 'Types unknown';
    const primaryBenchmarkResult = this.resolvePrimaryBenchmarkResult(event);
    const reportLabel = hasReport
      ? `${reportCount} report${reportCount === 1 ? '' : 's'}`
      : 'No reports';
    const benchmarkPairLabel = this.formatBenchmarkPairLabel(primaryBenchmarkResult);
    const benchmarkPairTitle = this.formatBenchmarkPairTitle(primaryBenchmarkResult);
    const reportTitle = this.buildComparisonReportTitle(reportLabel, benchmarkPairTitle, hasReport);
    const benchmarkFailure = this.benchmarkFailureByEventID()[eventID] ?? null;
    const statusPresentation = this.resolveComparisonStatusPresentation(hasReport, benchmarkFailure);
    const reportContext = this.buildBenchmarkReportContext(reportCount, benchmarkPairTitle);
    const gnssBenchmark = this.buildGnssBenchmarkMetricCell(primaryBenchmarkResult, reportContext);
    const heartRateBenchmark = this.buildStreamBenchmarkMetricCell(
      primaryBenchmarkResult,
      DataHeartRate.type,
      ['HeartRate', 'Heart Rate', 'Average Heart Rate'],
      'heart-rate',
      'bpm',
      reportContext,
    );
    const altitudeBenchmark = this.buildStreamBenchmarkMetricCell(
      primaryBenchmarkResult,
      DataAltitude.type,
      ['Altitude', 'Average Altitude'],
      'altitude',
      'm',
      reportContext,
    );

    return {
      id: eventID,
      title: comparisonEvent.comparisonTitle || event.name || 'Benchmark comparison',
      date: event.startDate instanceof Date ? event.startDate : null,
      activitySummaries,
      devicesLabel,
      activityTypesLabel,
      activityTypesTitle: activityTypeLabels.length > 0 ? activityTypeLabels.join('\n') : 'Types unknown',
      distanceTitle: this.formatSummaryTitle(activitySummaries, summary => summary.distanceLabel, 'Distance unknown'),
      ascentTitle: this.formatSummaryTitle(activitySummaries, summary => summary.ascentLabel, 'Ascent unknown'),
      descentTitle: this.formatSummaryTitle(activitySummaries, summary => summary.descentLabel, 'Descent unknown'),
      gnssBenchmark,
      heartRateBenchmark,
      altitudeBenchmark,
      description,
      benchmarkReviewTags,
      benchmarkReviewTagsTitle,
      deviceFilterValues,
      activityTypeFilterValues,
      tagFilterValues: benchmarkReviewTags,
      sourceFilesCount,
      sourceFilesLabel,
      sourceFilesTitle,
      hasReport,
      reportCount,
      reportLabel,
      reportTitle,
      benchmarkPairLabel,
      benchmarkPairTitle,
      statusLabel: statusPresentation.label,
      statusTitle: statusPresentation.title,
      statusIcon: statusPresentation.icon,
      statusState: statusPresentation.state,
      filterText: [
        comparisonEvent.comparisonTitle || event.name || 'Benchmark comparison',
        devicesLabel,
        activityTypesLabel,
        activitySummaries.map(summary => summary.filterText).join(' '),
        this.formatBenchmarkCellFilterText(gnssBenchmark),
        this.formatBenchmarkCellFilterText(heartRateBenchmark),
        this.formatBenchmarkCellFilterText(altitudeBenchmark),
        description,
        benchmarkReviewTags.join(' '),
        benchmarkPairLabel,
        event.startDate instanceof Date ? event.startDate.toISOString() : 'date unavailable',
        sourceFilesLabel,
        sourceFilesTitle,
        statusPresentation.label,
        statusPresentation.title,
        reportLabel,
      ].join(' ').toLowerCase(),
      event,
    };
  }

  private resolveComparisonStatusPresentation(
    hasReport: boolean,
    benchmarkFailure: ComparisonBenchmarkFailure | null,
  ): { label: string; title: string; icon: string; state: ComparisonStatusState } {
    if (benchmarkFailure?.type === 'no_overlap') {
      return {
        label: 'No time overlap',
        title: `Last benchmark attempt failed: ${benchmarkFailure.message} Choose overlapping activities and rerun the benchmark.`,
        icon: 'error',
        state: 'error',
      };
    }

    if (hasReport) {
      return {
        label: 'Report ready',
        title: 'Benchmark report is ready.',
        icon: 'check_circle',
        state: 'ready',
      };
    }

    return {
      label: 'Draft',
      title: 'No benchmark report has been generated yet.',
      icon: 'pending',
      state: 'draft',
    };
  }

  private isComparisonSortColumn(value: string): value is ComparisonSortColumn {
    return value === 'date';
  }

  private resolvePrimaryBenchmarkResult(event: AppEventInterface): BenchmarkResult | null {
    const benchmarkResults = Object.values(event.benchmarkResults || {});
    const candidates = benchmarkResults.length > 0
      ? benchmarkResults
      : [event.benchmarkResult as BenchmarkResult | undefined].filter((result): result is BenchmarkResult => !!result);

    if (candidates.length === 0) {
      return null;
    }

    return candidates
      .map((result, index) => ({
        result,
        index,
        timestampMs: this.getBenchmarkTimestampMs(result),
      }))
      .reduce((selected, candidate) => {
        if (candidate.timestampMs !== null && selected.timestampMs !== null) {
          return candidate.timestampMs >= selected.timestampMs ? candidate : selected;
        }
        if (candidate.timestampMs !== null) {
          return candidate;
        }
        if (selected.timestampMs !== null) {
          return selected;
        }
        return candidate.index > selected.index ? candidate : selected;
      }).result;
  }

  private buildBenchmarkReportContext(reportCount: number, benchmarkPairTitle: string): string {
    return [
      reportCount > 1 ? `Showing latest of ${reportCount} reports.` : '',
      benchmarkPairTitle,
    ].filter(Boolean).join('\n');
  }

  private formatBenchmarkPairLabel(result: BenchmarkResult | null): string {
    if (!result) {
      return '';
    }

    const reference = this.formatBenchmarkParticipantLabel(result.referenceName, result.referenceId);
    const test = this.formatBenchmarkParticipantLabel(result.testName, result.testId);
    return reference && test ? `${reference} -> ${test}` : '';
  }

  private formatBenchmarkPairTitle(result: BenchmarkResult | null): string {
    const pairLabel = this.formatBenchmarkPairLabel(result);
    return pairLabel ? `Benchmark pair: ${pairLabel}.` : '';
  }

  private formatBenchmarkParticipantLabel(name: unknown, fallbackID: unknown): string {
    const label = `${name ?? ''}`.trim().replace(/\s+/g, ' ');
    if (label) {
      return label;
    }
    return `${fallbackID ?? ''}`.trim().replace(/\s+/g, ' ');
  }

  private buildComparisonReportTitle(reportLabel: string, benchmarkPairTitle: string, hasReport: boolean): string {
    if (!hasReport) {
      return MISSING_BENCHMARK_REPORT_TOOLTIP;
    }

    return [reportLabel, benchmarkPairTitle].filter(Boolean).join('\n');
  }

  private buildGnssBenchmarkMetricCell(
    result: BenchmarkResult | null,
    reportContext: string,
  ): ComparisonBenchmarkMetricCell {
    if (!result) {
      return this.buildPlaceholderBenchmarkMetricCell(MISSING_BENCHMARK_REPORT_TOOLTIP);
    }

    const gnss = result.metrics?.gnss;
    if (!gnss) {
      return this.buildPlaceholderBenchmarkMetricCell(this.appendReportContext('No GNSS metrics in latest benchmark report.', reportContext));
    }

    const meanDeviation = this.getFiniteNumber(gnss.meanDeviation);
    const meanAbsoluteError = this.getFiniteNumber(gnss.meanAbsoluteError);
    const cep50 = this.getFiniteNumber(gnss.cep50);
    const rmse = this.getFiniteNumber(gnss.rmse);
    const hasLegacyGnssMeanGap = (meanDeviation === null || meanAbsoluteError === null) && (cep50 !== null || rmse !== null);
    const lines: ComparisonBenchmarkMetricLine[] = [
      this.buildBenchmarkMetricLine('MD', this.formatMetricValue(meanDeviation, 'm', 1)),
      this.buildBenchmarkMetricLine('MAE', this.formatMetricValue(meanAbsoluteError, 'm', 1)),
    ];

    if (cep50 !== null) {
      lines.push(this.buildBenchmarkMetricLine('CEP50', this.formatMetricValue(cep50, 'm', 1)));
    }
    if (rmse !== null) {
      lines.push(this.buildBenchmarkMetricLine('RMSE', this.formatMetricValue(rmse, 'm', 1)));
    }
    const colorSource = this.resolveBenchmarkMetricColorSource([
      { label: 'MAE', value: meanAbsoluteError },
      { label: 'CEP50', value: cep50 },
      { label: 'RMSE', value: rmse },
    ]);

    const title = [
      'GNSS benchmark metrics.',
      'MD: mean radial deviation; unsigned for GNSS.',
      'MAE: mean absolute radial deviation.',
      'CEP50: median circular error.',
      'RMSE: root mean square error.',
      this.buildBenchmarkMetricColorContext(colorSource, 'm', 1),
      hasLegacyGnssMeanGap ? 'MD/MAE are unavailable for older GNSS reports. Click to rerun the benchmark and store them.' : '',
      reportContext,
    ].filter(Boolean).join('\n');

    return {
      lines,
      sortValue: colorSource?.value ?? null,
      title,
      isPlaceholder: lines.every(line => line.isPlaceholder),
      canRerunReport: hasLegacyGnssMeanGap,
      color: this.resolveBenchmarkMetricColor(colorSource?.value ?? null),
      severityLabel: this.resolveBenchmarkMetricSeverityLabel(colorSource?.value ?? null),
      dominantLineLabel: colorSource?.label ?? null,
    };
  }

  private buildStreamBenchmarkMetricCell(
    result: BenchmarkResult | null,
    streamType: string,
    streamAliases: string[],
    streamLabel: string,
    unit: string,
    reportContext: string,
  ): ComparisonBenchmarkMetricCell {
    if (!result) {
      return this.buildPlaceholderBenchmarkMetricCell(MISSING_BENCHMARK_REPORT_TOOLTIP);
    }

    const metrics = resolveBenchmarkStreamMetrics(result.metrics?.streamMetrics || {}, streamType, streamAliases);
    if (!metrics) {
      return this.buildPlaceholderBenchmarkMetricCell(
        this.appendReportContext(`No ${streamLabel} stream in latest benchmark report.`, reportContext),
      );
    }

    const meanDeviation = this.getFiniteNumber(resolveBenchmarkStreamMeanDeviation(metrics));
    const meanAbsoluteError = this.getFiniteNumber(metrics.meanAbsoluteError);
    const decimals = unit === 'bpm' ? 0 : 1;
    const lines: ComparisonBenchmarkMetricLine[] = [
      this.buildBenchmarkMetricLine('MD', this.formatMetricValue(meanDeviation, unit, decimals, true)),
      this.buildBenchmarkMetricLine('MAE', this.formatMetricValue(meanAbsoluteError, unit, decimals)),
    ];
    const title = [
      `${this.capitalizeMetricLabel(streamLabel)} benchmark metrics.`,
      'MD: signed mean deviation, test minus reference.',
      'MAE: mean absolute deviation.',
      this.buildBenchmarkMetricColorContext(
        meanAbsoluteError === null ? null : { label: 'MAE', value: meanAbsoluteError },
        unit,
        decimals,
      ),
      reportContext,
    ].filter(Boolean).join('\n');

    return {
      lines,
      sortValue: meanAbsoluteError,
      title,
      isPlaceholder: lines.every(line => line.isPlaceholder),
      canRerunReport: false,
      color: this.resolveBenchmarkMetricColor(meanAbsoluteError),
      severityLabel: this.resolveBenchmarkMetricSeverityLabel(meanAbsoluteError),
      dominantLineLabel: meanAbsoluteError === null ? null : 'MAE',
    };
  }

  private buildPlaceholderBenchmarkMetricCell(title: string): ComparisonBenchmarkMetricCell {
    return {
      lines: [
        this.buildBenchmarkMetricLine('MD', '-'),
        this.buildBenchmarkMetricLine('MAE', '-'),
      ],
      sortValue: null,
      title,
      isPlaceholder: true,
      canRerunReport: false,
      color: null,
      severityLabel: 'missing',
      dominantLineLabel: null,
    };
  }

  private buildBenchmarkMetricLine(label: string, value: string): ComparisonBenchmarkMetricLine {
    return {
      label,
      value,
      isPlaceholder: value === '-',
    };
  }

  private appendReportContext(message: string, reportContext: string): string {
    return reportContext ? `${message}\n${reportContext}` : message;
  }

  private formatBenchmarkCellFilterText(cell: ComparisonBenchmarkMetricCell): string {
    return cell.lines
      .filter(line => !line.isPlaceholder)
      .map(line => `${line.label} ${line.value}`)
      .join(' ')
      .toLowerCase();
  }

  private resolveBenchmarkMetricColorSource(
    candidates: Array<{ label: string; value: number | null }>,
  ): { label: string; value: number } | null {
    const candidate = candidates.find(item => item.value !== null);
    if (!candidate || candidate.value === null) {
      return null;
    }
    return {
      label: candidate.label,
      value: candidate.value,
    };
  }

  private resolveBenchmarkMetricColor(value: number | null): string | null {
    if (value === null) {
      return null;
    }
    return this.eventColorService.getDifferenceColor(Math.abs(value));
  }

  private resolveBenchmarkMetricSeverityLabel(value: number | null): string {
    if (value === null) {
      return 'missing';
    }

    const absoluteValue = Math.abs(value);
    if (absoluteValue <= 2) {
      return 'low error';
    }
    if (absoluteValue <= 5) {
      return 'moderate error';
    }
    return 'high error';
  }

  private buildBenchmarkMetricColorContext(
    source: { label: string; value: number } | null,
    unit: string,
    decimals: number,
  ): string {
    if (!source) {
      return '';
    }
    return `Color: ${this.resolveBenchmarkMetricSeverityLabel(source.value)} (${source.label} ${this.formatMetricValue(source.value, unit, decimals)}; green <=2, orange <=5, red >5).`;
  }

  private getBenchmarkTimestampMs(result: BenchmarkResult): number | null {
    const timestamp = (result as { timestamp?: unknown }).timestamp;
    if (timestamp instanceof Date) {
      const timestampMs = timestamp.getTime();
      return Number.isFinite(timestampMs) ? timestampMs : null;
    }
    if (timestamp && typeof (timestamp as { toDate?: unknown }).toDate === 'function') {
      const date = (timestamp as { toDate: () => Date }).toDate();
      const timestampMs = date.getTime();
      return Number.isFinite(timestampMs) ? timestampMs : null;
    }
    if (timestamp && typeof timestamp === 'object' && typeof (timestamp as { seconds?: unknown }).seconds === 'number') {
      return (timestamp as { seconds: number }).seconds * 1000;
    }
    if (typeof timestamp === 'string' || typeof timestamp === 'number') {
      const timestampMs = new Date(timestamp).getTime();
      return Number.isFinite(timestampMs) ? timestampMs : null;
    }
    return null;
  }

  private getFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private formatMetricValue(
    value: number | null,
    unit: string,
    maxDecimals: number,
    signed = false,
  ): string {
    if (value === null) {
      return '-';
    }

    const roundedValue = Number(value.toFixed(maxDecimals));
    const prefix = signed && roundedValue > 0 ? '+' : '';
    return `${prefix}${roundedValue} ${unit}`;
  }

  private capitalizeMetricLabel(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  private buildComparisonActivitySummaries(activities: ActivityInterface[]): ComparisonActivitySummary[] {
    const unitSettings = this.currentUser()?.settings?.unitSettings ?? null;

    return activities.map((activity, index) => {
      const deviceLabel = this.resolveActivityDeviceLabel(activity, index);
      const deviceColorKey = this.deviceColorPreferenceService.normalizeDeviceColorKey(activity.creator?.name ?? '');
      const deviceColor = this.resolveActivityDeviceColor(activities, activity);
      const automaticDeviceColor = this.resolveAutomaticActivityDeviceColor(activities, activity);
      const activityTypeLabel = this.resolveActivityTypeLabel(activity);
      const activityID = `${activity.getID?.() ?? ''}`.trim() || this.normalizeDeviceNameKey(deviceLabel) || 'activity';
      const distanceStat = this.getActivityStat(activity, DataDistance.type) || activity.getDistance?.();
      const ascentStat = this.getActivityStat(activity, DataAscent.type);
      const descentStat = this.getActivityStat(activity, DataDescent.type);
      const distanceLabel = this.formatActivityStat(distanceStat, unitSettings);
      const ascentLabel = this.formatActivityStat(ascentStat, unitSettings);
      const descentLabel = this.formatActivityStat(descentStat, unitSettings);

      return {
        id: `${activityID}-${index}`,
        deviceLabel,
        deviceColorKey,
        deviceColor,
        automaticDeviceColor,
        activityTypeLabel,
        activityTypeIconValue: activityTypeLabel,
        distanceLabel,
        ascentLabel,
        descentLabel,
        filterText: [
          deviceLabel,
          activityTypeLabel,
          distanceLabel,
          ascentLabel,
          descentLabel,
        ].join(' ').toLowerCase(),
      };
    });
  }

  private resolveActivityDeviceColor(activities: ActivityInterface[], activity: ActivityInterface): string {
    try {
      return this.eventColorService.getActivityColor(activities, activity) || AppColors.Blue;
    } catch (error) {
      this.logger.warn('[ToolsComparePageComponent] Could not resolve comparison activity color.', {
        activityID: activity.getID?.() ?? null,
        error,
      });
      return AppColors.Blue;
    }
  }

  private resolveAutomaticActivityDeviceColor(activities: ActivityInterface[], activity: ActivityInterface): string {
    try {
      return this.eventColorService.getAutomaticActivityColor(activities, activity) || AppColors.Blue;
    } catch (error) {
      this.logger.warn('[ToolsComparePageComponent] Could not resolve automatic comparison activity color.', {
        activityID: activity.getID?.() ?? null,
        error,
      });
      return AppColors.Blue;
    }
  }

  private resolveActivityDeviceLabel(activity: ActivityInterface, index: number): string {
    const name = `${activity.creator?.name ?? ''}`.trim().replace(/\s+/g, ' ');
    const swInfo = `${activity.creator?.swInfo ?? ''}`.trim().replace(/\s+/g, ' ');
    if (name && swInfo) {
      return `${name} ${swInfo}`;
    }
    return name || `Device ${index + 1}`;
  }

  private resolveActivityTypeLabel(activity: ActivityInterface): string {
    const labels = this.resolveActivityTypeLabels(activity);
    return labels.length > 0 ? labels.join(', ') : 'Type unknown';
  }

  private resolveActivityTypeLabels(activity: ActivityInterface): string[] {
    const labels: string[] = [];
    const activityTypesString = (activity as { getActivityTypesAsString?: () => unknown }).getActivityTypesAsString?.();
    this.addActivityTypeLabels(labels, activityTypesString);

    const activityTypes = (activity as { getActivityTypesAsArray?: () => unknown }).getActivityTypesAsArray?.();
    this.addActivityTypeLabels(labels, activityTypes);

    const activityTypeStat = this.getActivityStat(activity, DataActivityTypes.type);
    this.addActivityTypeLabels(labels, activityTypeStat?.getDisplayValue?.());
    this.addActivityTypeLabels(labels, activityTypeStat?.getValue?.());

    this.addActivityTypeLabels(labels, (activity as { type?: unknown }).type);
    this.addActivityTypeLabels(labels, (activity as { activityType?: unknown }).activityType);
    this.addActivityTypeLabels(labels, (activity as { sport?: unknown }).sport);

    const distinctLabels = this.getDistinctLabels(labels);
    const knownLabels = distinctLabels.filter(label => !this.isUnknownActivityTypeLabel(label));
    return knownLabels.length > 0 ? knownLabels : distinctLabels;
  }

  private addActivityTypeLabels(labels: string[], value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(item => this.addActivityTypeLabels(labels, item));
      return;
    }

    if (typeof value === 'string' && value.includes(',')) {
      value.split(',').forEach(item => this.addActivityTypeLabels(labels, item));
      return;
    }

    const label = this.formatActivityTypeName(value);
    if (label) {
      labels.push(label);
    }
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

    const normalized = type
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ');
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
  }

  private isUnknownActivityTypeLabel(label: string): boolean {
    return ['unknown sport', 'not specified sport', 'type unknown'].includes(label.trim().toLowerCase());
  }

  private getActivityStat(activity: ActivityInterface, statType: string): DataInterface | null {
    const stat = (activity as { getStat?: (type: string) => DataInterface | null | undefined }).getStat?.(statType);
    return stat || null;
  }

  private formatActivityStat(
    stat: DataInterface | null | undefined,
    unitSettings: UserUnitSettingsInterface | null | undefined,
  ): string {
    if (!stat) {
      return '';
    }

    return resolveUnitAwareDisplayStat(stat, unitSettings ?? null, {
      stripRepeatedUnit: true,
      compactAscentDescent: true,
    })?.text ?? this.formatActivityStatFallback(stat);
  }

  private formatActivityStatFallback(stat: DataInterface): string {
    const displayValue = `${stat.getDisplayValue?.() ?? ''}`.trim();
    const displayUnit = `${stat.getDisplayUnit?.() ?? ''}`.trim();
    return displayUnit ? `${displayValue} ${displayUnit}`.trim() : displayValue;
  }

  private getDistinctLabels(labels: string[]): string[] {
    const seen = new Set<string>();
    const distinctLabels: string[] = [];

    for (const label of labels) {
      const normalized = label.trim();
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) {
        continue;
      }

      seen.add(key);
      distinctLabels.push(normalized);
    }

    return distinctLabels;
  }

  private buildComparisonFilterOptions(labels: string[]): ComparisonFilterOption[] {
    return this.getDistinctLabels(labels)
      .sort((first, second) => first.localeCompare(second))
      .map(label => ({
        value: label,
        label,
      }));
  }

  private buildBenchmarkDeviceKeys(benchmarkResults: Record<string, BenchmarkResult>): string[] {
    const deviceKeys = new Set<string>();
    Object.values(benchmarkResults).forEach((result) => {
      [result.referenceName, result.testName].forEach((name) => {
        const normalized = this.normalizeDeviceNameKey(name);
        if (normalized) {
          deviceKeys.add(normalized);
        }
      });
    });
    return Array.from(deviceKeys);
  }

  private formatSummaryTitle(
    summaries: ComparisonActivitySummary[],
    getValue: (summary: ComparisonActivitySummary) => string,
    emptyLabel: string,
  ): string {
    if (summaries.length === 0) {
      return emptyLabel;
    }

    return summaries
      .map(summary => `${summary.deviceLabel}: ${getValue(summary) || '-'}`)
      .join('\n');
  }

  private resolveComparisonDeviceNames(event: AppEventInterface, activities: ActivityInterface[]): string[] {
    const devices = new Map<string, { label: string; source: ComparisonDeviceSource }>();
    const addDevice = (
      name: unknown,
      options: { forceFormatted?: boolean; source: ComparisonDeviceSource },
    ): void => {
      const normalized = this.normalizeDeviceNameKey(name);
      if (!normalized || devices.has(normalized)) {
        return;
      }

      if (options.source === 'metadata') {
        const moreSpecificActivityLabelExists = Array.from(devices.entries()).some(([deviceKey, device]) =>
          device.source === 'activity' && deviceKey.startsWith(`${normalized} `),
        );
        if (moreSpecificActivityLabelExists) {
          return;
        }
      }

      if (options.source === 'activity') {
        for (const [deviceKey, device] of devices.entries()) {
          if (device.source === 'metadata' && deviceKey.startsWith(`${normalized} `)) {
            return;
          }
          if (device.source === 'metadata' && normalized.startsWith(`${deviceKey} `)) {
            devices.delete(deviceKey);
          }
        }
      }

      devices.set(normalized, {
        label: options.forceFormatted ? this.formatNormalizedDeviceName(normalized) : `${name}`.trim().replace(/\s+/g, ' '),
        source: options.source,
      });
    };

    Object.values(event.benchmarkResults || {}).forEach((result) => {
      addDevice(result.referenceName, { source: 'report' });
      addDevice(result.testName, { source: 'report' });
    });

    const legacyBenchmarkResult = event.benchmarkResult as BenchmarkResult | undefined;
    addDevice(legacyBenchmarkResult?.referenceName, { source: 'legacy-report' });
    addDevice(legacyBenchmarkResult?.testName, { source: 'legacy-report' });

    activities.forEach((activity) => {
      const name = activity.creator?.name || '';
      const swInfo = activity.creator?.swInfo || '';
      addDevice(swInfo ? `${name} ${swInfo}` : name, { source: 'activity' });
    });

    (event.benchmarkDevices || []).forEach(deviceName =>
      addDevice(deviceName, { forceFormatted: true, source: 'metadata' }),
    );

    return Array.from(devices.values()).map(device => device.label);
  }

  private normalizeDeviceNameKey(name: unknown): string | null {
    if (typeof name !== 'string') {
      return null;
    }

    const normalized = name.trim().replace(/\s+/g, ' ').toLowerCase();
    return normalized || null;
  }

  private formatNormalizedDeviceName(normalizedName: string): string {
    const brandLabels: Record<string, string> = {
      apple: 'Apple',
      coros: 'COROS',
      fitbit: 'Fitbit',
      garmin: 'Garmin',
      polar: 'Polar',
      suunto: 'Suunto',
      wahoo: 'Wahoo',
    };
    return normalizedName
      .split(' ')
      .map(part => brandLabels[part] || this.capitalizeDeviceNamePart(part))
      .join(' ');
  }

  private capitalizeDeviceNamePart(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  private resetComparisonPage(): void {
    this.comparisonPage.update(page => ({ ...page, pageIndex: 0 }));
  }

  private clearDescriptionDraft(eventID: string): void {
    this.descriptionDrafts.update((drafts) => {
      if (!(eventID in drafts)) {
        return drafts;
      }
      const nextDrafts = { ...drafts };
      delete nextDrafts[eventID];
      return nextDrafts;
    });
  }

  private clearDescriptionEdit(eventID: string): void {
    if (this.editingDescriptionEventID() === eventID) {
      this.editingDescriptionEventID.set(null);
    }
  }

  private getOriginalFilesCount(event: AppEventInterface): number | null {
    if (Array.isArray(event.originalFiles)) {
      return event.originalFiles.length;
    }
    return event.originalFile ? 1 : null;
  }

  private buildSourceFilesTitle(event: AppEventInterface, fallbackLabel: string): string {
    const filenames = this.getOriginalFileDisplayNames(event);
    return filenames.length > 0 ? filenames.join('\n') : fallbackLabel;
  }

  private getOriginalFileDisplayNames(event: AppEventInterface): string[] {
    const files = Array.isArray(event.originalFiles) && event.originalFiles.length > 0
      ? event.originalFiles
      : event.originalFile
        ? [event.originalFile]
        : [];

    return files
      .map(file => this.resolveOriginalFileDisplayName(file))
      .filter((filename): filename is string => !!filename);
  }

  private resolveOriginalFileDisplayName(file: { originalFilename?: unknown; path?: unknown }): string | null {
    const originalFilename = this.normalizeSourceFilename(file.originalFilename);
    if (originalFilename) {
      return originalFilename;
    }

    const path = typeof file.path === 'string' ? file.path : '';
    const basename = path.split('/').filter(Boolean).pop();
    return this.normalizeSourceFilename(basename);
  }

  private normalizeSourceFilename(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      return null;
    }

    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }

  private formatCountLabel(count: number | null, singularLabel: string, emptyLabel: string): string {
    if (count === null) {
      return emptyLabel;
    }
    const pluralLabel = singularLabel.endsWith('y')
      ? `${singularLabel.slice(0, -1)}ies`
      : `${singularLabel}s`;
    return `${count} ${count === 1 ? singularLabel : pluralLabel}`;
  }

  private resolveExtensionFromFilename(filename: string): string {
    const normalized = filename.trim().toLowerCase();
    const parts = normalized.split('.').filter(Boolean);
    if (parts.length < 2) {
      return '';
    }

    const last = parts[parts.length - 1];
    if (last === 'gz' && parts.length >= 3) {
      return `${parts[parts.length - 2]}.gz`;
    }
    return last;
  }

  private formatFileSize(size: number): string {
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
}
