import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, OnInit, signal } from '@angular/core';
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
  DataAscent,
  DataDescent,
  DataDistance,
  DataInterface,
  User,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';
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
import { AppToolsComparisonService, SavedBenchmarkComparisonsPage } from '../../services/app.tools-comparison.service';
import { LoggerService } from '../../services/logger.service';
import { ToolsCompareAuthResolverData } from '../../resolvers/tools-compare-auth.resolver';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppColors } from '../../services/color/app.colors';
import { AppDeviceColorPreferenceService } from '../../services/color/app-device-color-preference.service';
import {
  DeviceColorPreferenceDialogDevice,
  DeviceColorPreferencesDialogComponent,
} from './device-color-preferences-dialog.component';

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
  dateSortMs: number;
  activitySummaries: ComparisonActivitySummary[];
  devicesLabel: string;
  devicesSort: string;
  activityTypesLabel: string;
  activityTypesSort: string;
  activityTypesTitle: string;
  distanceSort: number | null;
  ascentSort: number | null;
  descentSort: number | null;
  distanceTitle: string;
  ascentTitle: string;
  descentTitle: string;
  description: string;
  sourceFilesCount: number | null;
  sourceFilesSort: number | null;
  sourceFilesLabel: string;
  hasReport: boolean;
  reportCount: number;
  reportLabel: string;
  statusLabel: string;
  statusRank: number;
  filterText: string;
  event: AppEventInterface;
}

interface ComparisonActivitySummary {
  id: string;
  deviceLabel: string;
  deviceColorKey: string;
  deviceColor: string;
  activityTypeLabel: string;
  distanceLabel: string;
  ascentLabel: string;
  descentLabel: string;
  distanceSort: number | null;
  ascentSort: number | null;
  descentSort: number | null;
  filterText: string;
}

type ComparisonSortColumn =
  | 'date'
  | 'title'
  | 'devices'
  | 'activityType'
  | 'distance'
  | 'ascent'
  | 'descent'
  | 'description'
  | 'sourceFiles'
  | 'status'
  | 'reports';
type ComparisonDeviceSource = 'report' | 'legacy-report' | 'metadata' | 'activity';

interface ComparisonSortState {
  active: ComparisonSortColumn;
  direction: Exclude<SortDirection, ''>;
}

interface ComparisonPageState {
  pageIndex: number;
  pageSize: number;
}

type ComparisonEventFields = AppEventInterface & {
  sourceFilesCount?: number;
  comparisonTitle?: string;
  benchmarkResult?: unknown;
};

const MAX_COMPARISON_FILES = 10;
const DEFAULT_COMPARISON_PAGE_SIZE = 25;
const COMPARISON_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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
  private logger = inject(LoggerService);

  readonly selectedFiles = signal<File[]>([]);
  readonly comparisonTitle = signal('');
  readonly isCreating = signal(false);
  readonly currentUser = signal<User | null>(null);
  readonly comparisons = signal<AppEventInterface[]>([]);
  readonly comparisonTotalCount = signal(0);
  readonly isLoadingComparisons = signal(false);
  readonly deletingEventID = signal<string | null>(null);
  readonly savingDescriptionEventID = signal<string | null>(null);
  readonly editingDescriptionEventID = signal<string | null>(null);
  readonly descriptionDrafts = signal<Record<string, string>>({});
  readonly comparisonFilter = signal('');
  readonly comparisonSort = signal<ComparisonSortState>({ active: 'date', direction: 'desc' });
  readonly comparisonPage = signal<ComparisonPageState>({
    pageIndex: 0,
    pageSize: DEFAULT_COMPARISON_PAGE_SIZE,
  });
  readonly comparisonPageSizeOptions = COMPARISON_PAGE_SIZE_OPTIONS;
  readonly displayedComparisonColumns = [
    'date',
    'title',
    'devices',
    'activityType',
    'distance',
    'ascent',
    'descent',
    'description',
    'sourceFiles',
    'status',
    'reports',
    'actions',
  ];
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
    const items = this.comparisonItems();
    if (!filter) {
      return items;
    }

    return items.filter(item => item.filterText.includes(filter));
  });

  readonly sortedComparisonItems = computed<ComparisonListItem[]>(() => {
    const sort = this.comparisonSort();

    return [...this.filteredComparisonItems()].sort((first, second) =>
      this.compareComparisonItems(first, second, sort.active, sort.direction),
    );
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
          automaticColor: summary.deviceColor,
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
    const sort = this.comparisonSort();
    const sortScopeLabel = sort.active === 'date' && sort.direction === 'desc' ? '' : '; sorting loaded rows';
    return `${loaded} of ${total} loaded${sortScopeLabel}`;
  });

  ngOnInit(): void {
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
      input.value = '';
      return;
    }

    const files = Array.from(input.files || []);
    const summary = this.addFiles(files);
    if (summary) {
      this.analyticsService.logToolCompareFileSelection(summary);
    }
    input.value = '';
  }

  removeFile(index: number): void {
    if (this.isCreating()) {
      return;
    }

    this.selectedFiles.update(files => files.filter((_file, fileIndex) => fileIndex !== index));
  }

  clearFiles(): void {
    if (this.isCreating()) {
      return;
    }

    this.selectedFiles.set([]);
  }

  updateTitle(value: string): void {
    if (this.isCreating()) {
      return;
    }

    this.comparisonTitle.set(value);
  }

  updateComparisonFilter(value: string): void {
    const nextFilterActive = value.trim().length > 0;
    this.comparisonFilter.set(value);
    this.resetComparisonPage();
    if (nextFilterActive !== this.lastLoggedFilterActive) {
      this.analyticsService.logToolCompareSavedAction('filter', {
        status: nextFilterActive ? 'applied' : 'cleared',
        filterActive: nextFilterActive,
        resultCount: this.filteredComparisonCount(),
      });
      this.lastLoggedFilterActive = nextFilterActive;
    }
  }

  onComparisonSortChange(sort: Sort): void {
    const active = this.isComparisonSortColumn(sort.active) ? sort.active : 'date';
    const direction = sort.direction || (active === 'date' ? 'desc' : 'asc');
    this.comparisonSort.set({ active, direction });
    this.resetComparisonPage();
    this.analyticsService.logToolCompareSavedAction('sort', {
      sortColumn: active,
      sortDirection: direction,
      filterActive: this.isComparisonFilterActive(),
      resultCount: this.filteredComparisonCount(),
    });
  }

  async onComparisonPageChange(event: PageEvent): Promise<void> {
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
        return;
      }
      this.comparisonPage.set({
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      });
    }

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

  startDescriptionEdit(item: ComparisonListItem): void {
    if (this.savingDescriptionEventID()) {
      return;
    }

    this.editingDescriptionEventID.set(item.id);
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
      return;
    }

    const nextDescription = this.descriptionDrafts()[item.id] ?? item.description;
    if (nextDescription === item.description) {
      this.clearDescriptionDraft(item.id);
      this.clearDescriptionEdit(item.id);
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
      this.analyticsService.logToolCompareSavedAction('description_save', this.getComparisonSavedActionAnalytics(item, {
        status: 'success',
        hadDescription: !!item.description,
      }));
    } catch (error) {
      this.clearDescriptionDraft(item.id);
      this.clearDescriptionEdit(item.id);
      this.snackBar.open('Could not save description.', undefined, { duration: 3000 });
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
      this.analyticsService.logToolCompareCreate('validation_failure', {
        ...this.getComparisonCreateAnalytics(),
        errorCategory: this.resolveComparisonErrorCategory(validationError),
      });
      return;
    }

    this.isCreating.set(true);
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
      await this.router.navigate(['/user', user.uid, 'event', result.eventId], {
        queryParams: { benchmark: '1' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create comparison.';
      this.snackBar.open(message, 'Close', { duration: 5000 });
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

    this.analyticsService.logToolCompareSavedAction(
      benchmark ? (item.hasReport ? 'open_report' : 'run_report') : 'open_details',
      this.getComparisonSavedActionAnalytics(item),
    );
    await this.router.navigate(['/user', user.uid, 'event', item.id], {
      queryParams: benchmark ? { benchmark: '1' } : undefined,
    });
  }

  async deleteComparison(item: ComparisonListItem): Promise<void> {
    if (this.deletingEventID()) {
      return;
    }

    const user = this.currentUser();
    if (!user) {
      return;
    }

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
      this.analyticsService.logToolCompareSavedAction('delete', this.getComparisonSavedActionAnalytics(item, {
        status: 'success',
      }));
    } catch (error) {
      this.snackBar.open('Could not delete comparison.', undefined, { duration: 3000 });
      this.analyticsService.logToolCompareSavedAction('delete', this.getComparisonSavedActionAnalytics(item, {
        status: 'failure',
      }));
    } finally {
      this.deletingEventID.set(null);
    }
  }

  openDeviceColorPreferencesDialog(initialDeviceKey?: string | null): void {
    const devices = this.comparisonDeviceColorItems();
    if (devices.length === 0) {
      return;
    }

    this.dialog.open(DeviceColorPreferencesDialogComponent, {
      width: 'min(40rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        devices,
        initialDeviceKey: initialDeviceKey || null,
      },
    });
  }

  async signIn(redirectUrl = '/tools/compare', source: ToolCompareSignInSource = 'guest_cta'): Promise<void> {
    this.analyticsService.logToolCompareSignIn(source, redirectUrl === '/tools/compare/saved' ? 'saved' : 'compare');
    this.authService.redirectUrl = redirectUrl;
    await this.router.navigate(['/login'], { queryParams: { returnUrl: redirectUrl } });
  }

  private async loadInitialComparisonPage(user: User): Promise<void> {
    const loadGeneration = ++this.comparisonLoadGeneration;
    this.clearComparisonPageCache();
    this.comparisonTotalCount.set(0);
    this.isLoadingComparisons.set(true);

    try {
      const pageSize = this.comparisonPage().pageSize;
      const [totalCount, firstPage] = await Promise.all([
        firstValueFrom(this.comparisonService.getBenchmarkComparisonCount(user)),
        firstValueFrom(this.comparisonService.getBenchmarkComparisonPage(user, { pageSize })),
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
    let removedLoadedPage = false;
    for (const [pageIndex, pageEvents] of this.loadedComparisonPages.entries()) {
      const nextPageEvents = pageEvents.filter(event => event.getID() !== eventID);
      if (nextPageEvents.length !== pageEvents.length) {
        removedLoadedPage = true;
      }
      this.loadedComparisonPages.set(pageIndex, nextPageEvents);
    }

    if (removedLoadedPage) {
      this.syncComparisonPages();
      return;
    }

    this.comparisons.update(events => events.filter(event => event.getID() !== eventID));
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
    this.hydratingActivitySummaryEventIDs.clear();
    this.hydratedActivitySummaryEventIDs.clear();
    this.isLoadingComparisons.set(false);
    this.resetComparisonPage();
  }

  private isCurrentComparisonLoad(loadGeneration: number, user: User): boolean {
    return this.comparisonLoadGeneration === loadGeneration && this.currentUser()?.uid === user.uid;
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
    return this.comparisonFilter().trim().length > 0;
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
    const statusLabel = hasReport ? 'Report ready' : 'Draft';
    const reportLabel = hasReport
      ? `${reportCount} report${reportCount === 1 ? '' : 's'}`
      : 'No reports';
    const description = typeof event.description === 'string' ? event.description : '';
    const sourceFilesCount = typeof comparisonEvent.sourceFilesCount === 'number'
      ? comparisonEvent.sourceFilesCount
      : this.getOriginalFilesCount(event);
    const activities = event.getActivities?.() || [];
    const activitySummaries = this.buildComparisonActivitySummaries(activities);
    const deviceNames = this.resolveComparisonDeviceNames(event, activities);
    const devicesLabel = deviceNames.length > 0 ? deviceNames.join(', ') : 'Devices unknown';
    const activityTypeLabels = this.getDistinctLabels(activitySummaries.map(summary => summary.activityTypeLabel));
    const activityTypesLabel = activityTypeLabels.length > 0
      ? activityTypeLabels.join(', ')
      : 'Types unknown';

    return {
      id: eventID,
      title: comparisonEvent.comparisonTitle || event.name || 'Benchmark comparison',
      date: event.startDate instanceof Date ? event.startDate : null,
      dateSortMs: event.startDate instanceof Date ? event.startDate.getTime() : 0,
      activitySummaries,
      devicesLabel,
      devicesSort: deviceNames.length > 0 ? deviceNames.join(' ').toLowerCase() : '\uffff',
      activityTypesLabel,
      activityTypesSort: activityTypesLabel.toLowerCase(),
      activityTypesTitle: activityTypeLabels.length > 0 ? activityTypeLabels.join('\n') : 'Types unknown',
      distanceSort: this.getMetricSort(activitySummaries, 'distanceSort'),
      ascentSort: this.getMetricSort(activitySummaries, 'ascentSort'),
      descentSort: this.getMetricSort(activitySummaries, 'descentSort'),
      distanceTitle: this.formatSummaryTitle(activitySummaries, summary => summary.distanceLabel, 'Distance unknown'),
      ascentTitle: this.formatSummaryTitle(activitySummaries, summary => summary.ascentLabel, 'Ascent unknown'),
      descentTitle: this.formatSummaryTitle(activitySummaries, summary => summary.descentLabel, 'Descent unknown'),
      description,
      sourceFilesCount,
      sourceFilesSort: sourceFilesCount,
      sourceFilesLabel: this.formatCountLabel(sourceFilesCount, 'file', 'Files unknown'),
      hasReport,
      reportCount,
      reportLabel,
      statusLabel,
      statusRank: hasReport ? 1 : 0,
      filterText: [
        comparisonEvent.comparisonTitle || event.name || 'Benchmark comparison',
        devicesLabel,
        activityTypesLabel,
        activitySummaries.map(summary => summary.filterText).join(' '),
        description,
        event.startDate instanceof Date ? event.startDate.toISOString() : 'date unavailable',
        this.formatCountLabel(sourceFilesCount, 'file', 'Files unknown'),
        statusLabel,
        reportLabel,
      ].join(' ').toLowerCase(),
      event,
    };
  }

  private compareComparisonItems(
    first: ComparisonListItem,
    second: ComparisonListItem,
    column: ComparisonSortColumn,
    direction: SortDirection,
  ): number {
    const directionMultiplier = direction === 'asc' ? 1 : -1;

    switch (column) {
      case 'date':
        return (first.dateSortMs - second.dateSortMs) * directionMultiplier;
      case 'title':
        return first.title.localeCompare(second.title) * directionMultiplier;
      case 'devices':
        return first.devicesSort.localeCompare(second.devicesSort) * directionMultiplier;
      case 'activityType':
        return first.activityTypesSort.localeCompare(second.activityTypesSort) * directionMultiplier;
      case 'distance':
        return this.compareNullableNumbers(first.distanceSort, second.distanceSort, direction);
      case 'ascent':
        return this.compareNullableNumbers(first.ascentSort, second.ascentSort, direction);
      case 'descent':
        return this.compareNullableNumbers(first.descentSort, second.descentSort, direction);
      case 'description':
        return first.description.localeCompare(second.description) * directionMultiplier;
      case 'sourceFiles':
        return this.compareNullableNumbers(first.sourceFilesSort, second.sourceFilesSort, direction);
      case 'status':
        return (first.statusRank - second.statusRank) * directionMultiplier;
      case 'reports':
        return (first.reportCount - second.reportCount) * directionMultiplier;
    }

    return 0;
  }

  private isComparisonSortColumn(value: string): value is ComparisonSortColumn {
    return ['date', 'title', 'devices', 'activityType', 'distance', 'ascent', 'descent', 'description', 'sourceFiles', 'status', 'reports'].includes(value);
  }

  private compareNullableNumbers(first: number | null, second: number | null, direction: SortDirection): number {
    if (first === null && second === null) {
      return 0;
    }
    if (first === null) {
      return 1;
    }
    if (second === null) {
      return -1;
    }

    return direction === 'asc' ? first - second : second - first;
  }

  private buildComparisonActivitySummaries(activities: ActivityInterface[]): ComparisonActivitySummary[] {
    const unitSettings = this.currentUser()?.settings?.unitSettings ?? null;

    return activities.map((activity, index) => {
      const deviceLabel = this.resolveActivityDeviceLabel(activity, index);
      const deviceColorKey = this.deviceColorPreferenceService.normalizeDeviceColorKey(activity.creator?.name ?? '');
      const deviceColor = this.resolveActivityDeviceColor(activities, activity);
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
        activityTypeLabel,
        distanceLabel,
        ascentLabel,
        descentLabel,
        distanceSort: this.getActivityStatNumericValue(distanceStat),
        ascentSort: this.getActivityStatNumericValue(ascentStat),
        descentSort: this.getActivityStatNumericValue(descentStat),
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

  private getActivityStatNumericValue(stat: DataInterface | null | undefined): number | null {
    const value = Number(stat?.getValue?.());
    return Number.isFinite(value) ? value : null;
  }

  private getMetricSort(
    summaries: ComparisonActivitySummary[],
    field: 'distanceSort' | 'ascentSort' | 'descentSort',
  ): number | null {
    const values = summaries
      .map(summary => summary[field])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return values.length > 0 ? Math.max(...values) : null;
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
