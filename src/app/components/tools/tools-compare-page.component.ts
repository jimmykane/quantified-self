import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { Sort, SortDirection } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';
import { catchError, firstValueFrom, of, switchMap, tap } from 'rxjs';

import { AppAuthService } from '../../authentication/app.auth.service';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { SharedModule } from '../../modules/shared.module';
import { AppEventService } from '../../services/app.event.service';
import { AppToolsComparisonService } from '../../services/app.tools-comparison.service';
import { LoggerService } from '../../services/logger.service';

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
  devicesLabel: string;
  devicesSort: string;
  description: string;
  sourceFilesCount: number | null;
  activitiesCount: number | null;
  sourceFilesSort: number;
  activitiesSort: number;
  sourceFilesLabel: string;
  activitiesLabel: string;
  hasReport: boolean;
  reportCount: number;
  reportLabel: string;
  statusLabel: string;
  statusRank: number;
  filterText: string;
  event: AppEventInterface;
}

type ComparisonSortColumn = 'date' | 'title' | 'devices' | 'description' | 'sourceFiles' | 'activities' | 'status' | 'reports';
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
  activitiesCount?: number;
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
  private eventService = inject(AppEventService);
  private comparisonService = inject(AppToolsComparisonService);
  private logger = inject(LoggerService);

  readonly selectedFiles = signal<File[]>([]);
  readonly comparisonTitle = signal('');
  readonly isCreating = signal(false);
  readonly currentUser = signal<User | null>(null);
  readonly comparisons = signal<AppEventInterface[]>([]);
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
    'description',
    'sourceFiles',
    'activities',
    'status',
    'reports',
    'actions',
  ];
  private readonly initialTabIndex = this.route.snapshot.data['defaultTab'] === 'saved' ? 1 : 0;
  readonly guestSignInRedirectUrl = this.initialTabIndex === 1 ? '/tools/compare/saved' : '/tools/compare';
  readonly showSavedComparisonsFirst = this.initialTabIndex === 1;
  private readonly hydratingDeviceEventIDs = new Set<string>();
  private readonly hydratedDeviceEventIDs = new Set<string>();

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
    const directionMultiplier = sort.direction === 'asc' ? 1 : -1;

    return [...this.filteredComparisonItems()].sort((first, second) =>
      this.compareComparisonItems(first, second, sort.active) * directionMultiplier,
    );
  });

  readonly paginatedComparisonItems = computed<ComparisonListItem[]>(() => {
    const page = this.comparisonPage();
    const start = page.pageIndex * page.pageSize;
    return this.sortedComparisonItems().slice(start, start + page.pageSize);
  });

  private readonly hydrateVisibleComparisonDevices = effect(() => {
    const user = this.currentUser();
    if (!user) {
      return;
    }

    const eventIDs = this.paginatedComparisonItems()
      .filter(item => this.shouldHydrateComparisonDeviceRow(item))
      .map(item => item.id)
      .filter(eventID => !this.hydratedDeviceEventIDs.has(eventID) && !this.hydratingDeviceEventIDs.has(eventID));

    if (eventIDs.length > 0) {
      void this.hydrateMissingDeviceRows(user, eventIDs);
    }
  });

  readonly filteredComparisonCount = computed(() => this.filteredComparisonItems().length);
  readonly comparisonResultSummary = computed(() => {
    const total = this.comparisonItems().length;
    const filtered = this.filteredComparisonCount();
    if (total === 0) {
      return 'No comparisons';
    }
    return filtered === total ? `${total} comparison${total === 1 ? '' : 's'}` : `${filtered} of ${total} comparisons`;
  });

  ngOnInit(): void {
    this.authService.user$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((user) => {
          const previousUserID = this.currentUser()?.uid ?? null;
          const nextUserID = user?.uid ?? null;
          const authScopeChanged = previousUserID !== nextUserID;

          this.currentUser.set(user);
          this.isLoadingComparisons.set(!!user);
          if (authScopeChanged) {
            this.comparisons.set([]);
            this.descriptionDrafts.set({});
            this.editingDescriptionEventID.set(null);
            this.hydratingDeviceEventIDs.clear();
            this.hydratedDeviceEventIDs.clear();
            this.resetComparisonPage();
          }
          if (!user || (previousUserID && previousUserID !== nextUserID)) {
            this.selectedFiles.set([]);
            this.comparisonTitle.set('');
          }
        }),
        switchMap((user) => {
          if (!user) {
            return of([]);
          }
          return this.comparisonService.getBenchmarkComparisons(user).pipe(
            tap(() => this.isLoadingComparisons.set(false)),
            catchError((error) => {
              this.isLoadingComparisons.set(false);
              this.logger.warn('[ToolsComparePageComponent] Could not load saved comparisons.', error);
              this.snackBar.open('Could not load saved comparisons.', undefined, { duration: 3000 });
              return of([]);
            }),
          );
        }),
      )
      .subscribe((events) => {
        this.comparisons.set(events);
        this.resetComparisonPage();
      });
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!this.currentUser()) {
      input.value = '';
      return;
    }

    const files = Array.from(input.files || []);
    this.addFiles(files);
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
    this.comparisonFilter.set(value);
    this.resetComparisonPage();
  }

  onComparisonSortChange(sort: Sort): void {
    const active = this.isComparisonSortColumn(sort.active) ? sort.active : 'date';
    const direction = sort.direction || (active === 'date' ? 'desc' : 'asc');
    this.comparisonSort.set({ active, direction });
    this.resetComparisonPage();
  }

  onComparisonPageChange(event: PageEvent): void {
    this.comparisonPage.set({
      pageIndex: event.pageIndex,
      pageSize: event.pageSize,
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
      this.comparisons.update(events => events.map((event) => {
        if (event.getID() === item.id) {
          event.description = nextDescription;
        }
        return event;
      }));
      this.clearDescriptionDraft(item.id);
      this.clearDescriptionEdit(item.id);
      this.snackBar.open('Description saved.', undefined, { duration: 2000 });
    } catch (error) {
      this.clearDescriptionDraft(item.id);
      this.clearDescriptionEdit(item.id);
      this.snackBar.open('Could not save description.', undefined, { duration: 3000 });
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
      await this.signIn('/tools/compare');
      return;
    }

    const validationError = this.comparisonService.validateFiles(this.selectedFiles());
    if (validationError) {
      this.snackBar.open(validationError, undefined, { duration: 3000 });
      return;
    }

    this.isCreating.set(true);
    try {
      const result = await this.comparisonService.createComparison(
        this.selectedFiles(),
        this.comparisonTitle(),
      );
      this.selectedFiles.set([]);
      this.comparisonTitle.set('');
      this.snackBar.open(result.alreadyExists ? 'Existing comparison opened.' : 'Comparison created.', undefined, { duration: 2000 });
      await this.router.navigate(['/user', user.uid, 'event', result.eventId], {
        queryParams: { benchmark: '1' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create comparison.';
      this.snackBar.open(message, 'Close', { duration: 5000 });
    } finally {
      this.isCreating.set(false);
    }
  }

  async openComparison(item: ComparisonListItem, benchmark: boolean): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      await this.signIn('/tools/compare/saved');
      return;
    }

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

    this.deletingEventID.set(item.id);
    try {
      await this.eventService.deleteAllEventData(user, item.id);
      this.comparisons.update(events => events.filter(event => event.getID() !== item.id));
      this.resetComparisonPage();
      this.snackBar.open('Comparison deleted.', undefined, { duration: 2000 });
    } catch (error) {
      this.snackBar.open('Could not delete comparison.', undefined, { duration: 3000 });
    } finally {
      this.deletingEventID.set(null);
    }
  }

  async signIn(redirectUrl = '/tools/compare'): Promise<void> {
    this.authService.redirectUrl = redirectUrl;
    await this.router.navigate(['/login'], { queryParams: { returnUrl: redirectUrl } });
  }

  private addFiles(files: File[]): void {
    if (this.isCreating() || !this.currentUser() || !files.length) {
      return;
    }

    const nextFiles = [...this.selectedFiles()];
    const rejectedNames: string[] = [];
    let rejectedForLimit = false;

    for (const file of files) {
      if (nextFiles.length >= MAX_COMPARISON_FILES) {
        rejectedForLimit = true;
        continue;
      }

      const extension = this.resolveExtensionFromFilename(file.name);
      const baseExtension = extension.endsWith('.gz') ? extension.slice(0, -3) : extension;
      if (!['fit', 'gpx', 'tcx'].includes(baseExtension)) {
        rejectedNames.push(file.name || 'Selected file');
        continue;
      }

      nextFiles.push(file);
    }

    this.selectedFiles.set(nextFiles);
    if (rejectedForLimit) {
      this.snackBar.open(`You can compare up to ${MAX_COMPARISON_FILES} files at once.`, undefined, { duration: 3000 });
    } else if (rejectedNames.length > 0) {
      this.snackBar.open('Only FIT, GPX, and TCX files are supported.', undefined, { duration: 3000 });
    }
  }

  private async hydrateMissingDeviceRows(user: User, eventIDs: string[]): Promise<void> {
    eventIDs.forEach(eventID => this.hydratingDeviceEventIDs.add(eventID));

    for (const eventID of eventIDs) {
      try {
        const activities = await firstValueFrom(this.eventService.getActivitiesOnceByEvent(user, eventID));
        if (!activities.length) {
          continue;
        }

        this.comparisons.update(events => events.map((event) => {
          if (event.getID() !== eventID || (event.getActivities?.() || []).length > 0) {
            return event;
          }
          return this.attachActivitiesToEvent(event, activities);
        }));
      } catch (error) {
        this.logger.warn('[ToolsComparePageComponent] Could not hydrate comparison devices.', { eventID, error });
      } finally {
        this.hydratedDeviceEventIDs.add(eventID);
        this.hydratingDeviceEventIDs.delete(eventID);
      }
    }
  }

  private shouldHydrateComparisonDeviceRow(item: ComparisonListItem): boolean {
    if (this.hydratedDeviceEventIDs.has(item.id) || this.hydratingDeviceEventIDs.has(item.id)) {
      return false;
    }

    const activities = item.event.getActivities?.() || [];
    if (activities.length > 0) {
      return false;
    }

    return item.devicesLabel === 'Devices unknown' || !item.hasReport;
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
    const activitiesCount = typeof comparisonEvent.activitiesCount === 'number'
      ? comparisonEvent.activitiesCount
      : (activities.length > 0 ? activities.length : null);
    const deviceNames = this.resolveComparisonDeviceNames(event, activities);
    const devicesLabel = deviceNames.length > 0 ? deviceNames.join(', ') : 'Devices unknown';

    return {
      id: eventID,
      title: comparisonEvent.comparisonTitle || event.name || 'Benchmark comparison',
      date: event.startDate instanceof Date ? event.startDate : null,
      dateSortMs: event.startDate instanceof Date ? event.startDate.getTime() : 0,
      devicesLabel,
      devicesSort: deviceNames.length > 0 ? deviceNames.join(' ').toLowerCase() : '\uffff',
      description,
      sourceFilesCount,
      activitiesCount,
      sourceFilesSort: sourceFilesCount ?? -1,
      activitiesSort: activitiesCount ?? -1,
      sourceFilesLabel: this.formatCountLabel(sourceFilesCount, 'file', 'Files unknown'),
      activitiesLabel: this.formatCountLabel(activitiesCount, 'activity', 'Activities unknown'),
      hasReport,
      reportCount,
      reportLabel,
      statusLabel,
      statusRank: hasReport ? 1 : 0,
      filterText: [
        comparisonEvent.comparisonTitle || event.name || 'Benchmark comparison',
        devicesLabel,
        description,
        event.startDate instanceof Date ? event.startDate.toISOString() : 'date unavailable',
        this.formatCountLabel(sourceFilesCount, 'file', 'Files unknown'),
        this.formatCountLabel(activitiesCount, 'activity', 'Activities unknown'),
        statusLabel,
        reportLabel,
      ].join(' ').toLowerCase(),
      event,
    };
  }

  private compareComparisonItems(first: ComparisonListItem, second: ComparisonListItem, column: ComparisonSortColumn): number {
    switch (column) {
      case 'date':
        return first.dateSortMs - second.dateSortMs;
      case 'title':
        return first.title.localeCompare(second.title);
      case 'devices':
        return first.devicesSort.localeCompare(second.devicesSort);
      case 'description':
        return first.description.localeCompare(second.description);
      case 'sourceFiles':
        return first.sourceFilesSort - second.sourceFilesSort;
      case 'activities':
        return first.activitiesSort - second.activitiesSort;
      case 'status':
        return first.statusRank - second.statusRank;
      case 'reports':
        return first.reportCount - second.reportCount;
    }

    return 0;
  }

  private isComparisonSortColumn(value: string): value is ComparisonSortColumn {
    return ['date', 'title', 'devices', 'description', 'sourceFiles', 'activities', 'status', 'reports'].includes(value);
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
    return `${count} ${singularLabel}${count === 1 ? '' : 's'}`;
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
