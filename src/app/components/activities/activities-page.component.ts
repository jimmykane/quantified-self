import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, OnInit, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import { combineLatest, Subscription, take } from 'rxjs';
import dayjs, { type Dayjs } from 'dayjs';
import { normalizeEventTagSuggestions } from '@shared/event-tags';
import type { AppEventInterface } from '@shared/app-event.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import type { AppUserInterface } from '../../models/app-user.interface';
import type { FirebaseUserType } from '../../firebase/auth';
import { buildEventTagLibrary } from '../../helpers/event-tag-library.helper';
import { ACTIVITY_EXPLORER_PERIODS, activityExplorerDateRange, activityExplorerSports, filterActivityExplorerEvents, normalizeActivityExplorerCustomDates, normalizeActivityExplorerSports, type ActivityExplorerCustomDates, type ActivityExplorerPeriod } from '../../helpers/activity-explorer.helper';
import { getActivityTypeFamilyFilterOptions } from '../../helpers/activity-type-family-filter.helper';
import { ActivityFilterPickerComponent, type ActivityFilterPickerOption } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { isNormalActivityEvent } from '../../helpers/normal-activity-event.helper';
import type { EventTableEventsChange } from '../event-table/event.table.component';
import { ConfirmationDialogComponent, type ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { EventTableModule } from '../../modules/event-table.module';
import { SharedModule } from '../../modules/shared.module';
import { AppEventService } from '../../services/app.event.service';
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-activities-page',
  standalone: true,
  imports: [SharedModule, EventTableModule, ActivityFilterPickerComponent],
  templateUrl: './activities-page.component.html',
  styleUrls: ['./activities-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivitiesPageComponent implements OnInit {
  private readonly auth = inject(AppAuthService);
  private readonly eventService = inject(AppEventService);
  private readonly catalog = inject(EventTagCatalogService);
  private readonly haptics = inject(AppHapticsService);
  private readonly logger = inject(LoggerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly datePresets = viewChild<MatSelect>('datePresets');
  private readonly customStartDate = viewChild<ElementRef<HTMLInputElement>>('customStartDate');
  private readonly localDayStartMs = signal(new Date().setHours(0, 0, 0, 0));
  private owner: FirebaseUserType | null = null;
  private generation = 0;
  private eventsSubscription?: Subscription;
  private catalogVersion = 0;
  private urlPeriod: ActivityExplorerPeriod = 'month';
  private allDatesDialog?: MatDialogRef<ConfirmationDialogComponent, boolean>;
  readonly user = signal<AppUserInterface | null>(null);
  readonly tableUsers = computed(() => { const user = this.user(); return user ? [user] : []; });
  readonly events = signal<AppEventInterface[]>([]);
  readonly catalogTags = signal<string[]>([]);
  readonly selectedTags = signal<string[]>([]);
  readonly selectedSports = signal<string[]>([]);
  readonly periods = ACTIVITY_EXPLORER_PERIODS;
  readonly defaultPeriod: ActivityExplorerPeriod = 'month';
  readonly period = signal<ActivityExplorerPeriod>(this.defaultPeriod);
  readonly periodLabel = computed(() => this.periods.find(period => period.value === this.period())!.label);
  readonly customDates = signal<ActivityExplorerCustomDates | null>(null);
  readonly customRangeOpen = signal(false);
  readonly showCustomRange = computed(() => this.customRangeOpen() || this.period() === 'custom');
  readonly customDateForm = new FormGroup({
    start: new FormControl<Dayjs | null>(null, Validators.required),
    end: new FormControl<Dayjs | null>(null, Validators.required),
  }, { validators: control => {
    const { start, end } = control.value;
    return start?.isValid() && end?.isValid() && end.isBefore(start, 'day') ? { dateOrder: true } : null;
  } });
  readonly untagged = signal(false);
  readonly loading = signal(false);
  readonly catalogLoading = signal(false);
  readonly historyError = signal(false);
  readonly catalogError = signal(false);
  readonly library = computed(() => buildEventTagLibrary(this.events(), [...this.catalogTags(), ...this.selectedTags()]));
  readonly selectedTagNames = computed(() => this.selectedTags().map(tag => this.library().find(entry => entry.key === tag.toLowerCase())?.name || tag));
  readonly tagOptions = computed<ActivityFilterPickerOption[]>(() => [
    { value: 'untagged', label: 'Untagged', icon: 'label_off' },
    ...this.library().map(tag => ({ value: `tag:${tag.key}`, label: tag.name, icon: 'sell' })),
  ]);
  readonly tagFilterValues = computed(() => [...this.selectedTags().map(tag => `tag:${tag.toLowerCase()}`), ...(this.untagged() ? ['untagged'] : [])]);
  readonly sports = computed(() => activityExplorerSports(this.events(), this.selectedSports(), true));
  readonly sportOptions = computed(() => this.sports().map(sport => ({ value: sport, label: sport, activityType: sport })));
  readonly sportShortcuts = computed(() => getActivityTypeFamilyFilterOptions(this.selectedSports(), this.sports())
    .map(family => ({ label: family.label, values: family.activityTypes })));
  readonly filters = computed(() => ({
    tags: this.selectedTags(), untagged: this.untagged(), sports: this.selectedSports(), period: this.period(),
    customDates: this.period() === 'custom' ? this.customDates() : null,
  }));
  readonly filterContext = computed(() => JSON.stringify(this.filters()));
  readonly hasFilters = computed(() => !!this.selectedTags().length || this.untagged() || !!this.selectedSports().length || this.period() !== this.defaultPeriod);
  readonly filteredEvents = computed(() => this.user()
    ? filterActivityExplorerEvents(this.events(), this.filters(), new Date(this.localDayStartMs())) : []);
  readonly emptyMessage = computed(() => this.loading() ? 'Loading activities…'
    : this.historyError() ? 'Activities couldn’t be loaded'
      : this.selectedSports().length || this.selectedTags().length > 1 || (this.untagged() && this.selectedTags().length) ? 'No activities match these filters'
        : this.untagged() ? 'No untagged activities' : this.selectedTags().length ? 'No activities with this tag' : 'No activities in this date range');
  readonly emptyHint = computed(() => this.loading() ? '' : this.historyError() ? 'Try again in a moment.'
    : this.hasFilters() ? 'Try another date range or clear a filter.' : 'Try a wider date range or import an activity.');

  constructor() {
    afterNextRender(() => {
      this.refreshLocalDay();
      const clock = globalThis.setInterval(() => this.refreshLocalDay(), 60_000);
      this.destroyRef.onDestroy(() => globalThis.clearInterval(clock));
    });
  }

  @HostListener('window:focus')
  refreshLocalDay(): void {
    const next = new Date().setHours(0, 0, 0, 0);
    if (next === this.localDayStartMs()) return;
    this.localDayStartMs.set(next);
    if (this.user() && this.period() !== 'all' && this.period() !== 'custom') this.loadHistory();
  }

  @HostListener('document:visibilitychange')
  refreshVisibleLocalDay(): void {
    if (this.document.visibilityState === 'visible') this.refreshLocalDay();
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.generation += 1;
      this.catalogVersion += 1;
      this.eventsSubscription?.unsubscribe();
      this.closeAllDatesWarning();
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const previousPeriod = this.period();
      this.selectedTags.set(normalizeEventTagSuggestions(params.getAll('tag')));
      this.untagged.set(params.get('untagged') === '1');
      this.selectedSports.set(normalizeActivityExplorerSports(params.getAll('sport')));
      const requestedPeriod = this.periods.find(period => period.value === params.get('period'))?.value || this.defaultPeriod;
      const customDates = requestedPeriod === 'custom' ? normalizeActivityExplorerCustomDates(params.get('start'), params.get('end')) : null;
      const period = requestedPeriod === 'custom' && !customDates ? this.defaultPeriod : requestedPeriod;
      this.urlPeriod = period;
      if (period === 'all' && this.period() !== 'all') {
        this.confirmAllDates();
        return;
      }
      this.closeAllDatesWarning();
      const rangeChanged = previousPeriod !== period || (period === 'custom'
        && (customDates?.startDate !== this.customDates()?.startDate || customDates?.endDate !== this.customDates()?.endDate));
      this.customDates.set(customDates);
      this.period.set(period);
      if (rangeChanged) {
        this.customRangeOpen.set(false);
        if (period === 'custom') this.resetCustomDateForm();
      }
      if (rangeChanged && this.user()) this.loadHistory();
      else this.refreshLocalDay();
      if (requestedPeriod === 'custom' && !customDates) this.updateUrl(true);
    });
    combineLatest([this.auth.user$, this.auth.authState$]).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([profile, owner]) => {
        const nextUser = owner && profile?.uid === owner.uid ? profile : null;
        if (nextUser?.uid === this.user()?.uid && owner === this.owner) {
          this.user.set(nextUser);
          return;
        }
        this.closeAllDatesWarning();
        this.customRangeOpen.set(false);
        if (this.period() === 'custom') this.resetCustomDateForm();
        if (this.period() === 'all') this.period.set(this.defaultPeriod);
        this.owner = owner;
        this.user.set(nextUser);
        this.catalogVersion += 1;
        this.catalogTags.set([]);
        this.catalogLoading.set(false);
        this.catalogError.set(false);
        this.generation += 1;
        this.eventsSubscription?.unsubscribe();
        this.eventsSubscription = undefined;
        this.events.set([]);
        this.loading.set(false);
        this.historyError.set(false);
        if (nextUser) {
          void this.loadCatalog();
          if (this.urlPeriod === 'all') this.confirmAllDates();
          else this.loadHistory();
        }
      });
  }

  selectTags(tags: readonly string[], untagged = false): void {
    const next = normalizeEventTagSuggestions(tags).sort((first, second) => first.toLowerCase().localeCompare(second.toLowerCase()));
    const current = new Set(this.selectedTags().map(tag => tag.toLowerCase()));
    if (next.length === current.size && next.every(tag => current.has(tag.toLowerCase())) && untagged === this.untagged()) return;
    this.selectedTags.set(next);
    this.untagged.set(untagged);
    this.filtersChanged();
  }

  selectTagFilters(values: readonly string[]): void {
    const tags = this.library().filter(tag => values.includes(`tag:${tag.key}`)).map(tag => tag.name);
    this.selectTags(tags, values.includes('untagged'));
  }

  removeTag(tag: string): void {
    this.selectTags(this.selectedTags().filter(value => value.toLowerCase() !== tag.toLowerCase()), this.untagged());
  }

  selectSports(sports: readonly string[]): void {
    const next = normalizeActivityExplorerSports(sports);
    const current = this.selectedSports();
    if (next.length === current.length && next.every(sport => current.includes(sport))) return;
    this.selectedSports.set(next);
    this.filtersChanged();
  }

  removeSport(sport: string): void {
    this.selectSports(this.selectedSports().filter(value => value !== sport));
  }

  selectPeriod(period: ActivityExplorerPeriod, select?: MatSelect): void {
    if (period === 'custom') {
      if (this.showCustomRange()) return;
      this.closeAllDatesWarning();
      this.resetCustomDateForm();
      this.customRangeOpen.set(true);
      this.focusDateControl();
      this.haptics.selection();
      return;
    }
    if (period === this.period()) {
      if (this.customRangeOpen()) this.cancelCustomRange();
      return;
    }
    this.customRangeOpen.set(false);
    if (period === 'all') {
      // Keep the displayed range consistent with its data while awaiting confirmation.
      if (select) select.value = this.period();
      this.confirmAllDates(true);
      return;
    }
    this.closeAllDatesWarning();
    this.period.set(period);
    this.customDates.set(null);
    this.loadHistory(true);
    this.filtersChanged();
  }

  clearFilters(): void {
    this.closeAllDatesWarning();
    this.customRangeOpen.set(false);
    if (!this.hasFilters()) return;
    this.selectedTags.set([]);
    this.untagged.set(false);
    this.selectedSports.set([]);
    const periodChanged = this.period() !== this.defaultPeriod;
    this.period.set(this.defaultPeriod);
    this.customDates.set(null);
    if (periodChanged) this.loadHistory(true);
    this.filtersChanged();
  }

  applyCustomRange(): void {
    this.customDateForm.markAllAsTouched();
    if (this.customDateForm.invalid || !this.user() || this.owner !== this.auth.currentUser) return;
    const { start, end } = this.customDateForm.getRawValue();
    const dates = normalizeActivityExplorerCustomDates(start?.format('YYYY-MM-DD'), end?.format('YYYY-MM-DD'));
    if (!dates) return;
    this.customRangeOpen.set(false);
    this.customDateForm.markAsPristine();
    if (this.period() === 'custom' && dates.startDate === this.customDates()?.startDate && dates.endDate === this.customDates()?.endDate) return;
    this.closeAllDatesWarning();
    this.customDates.set(dates);
    this.period.set('custom');
    this.loadHistory(true);
    this.filtersChanged();
  }

  cancelCustomRange(): void {
    if (!this.showCustomRange()) return;
    this.customRangeOpen.set(false);
    this.resetCustomDateForm();
    if (this.period() !== 'custom') this.focusDateControl();
    this.haptics.selection();
  }

  onCustomPickerOpened(): void {
    this.haptics.selection();
  }

  clearCustomRange(): void {
    if (this.period() === 'custom') {
      this.selectPeriod(this.defaultPeriod);
      this.focusDateControl();
    }
    else this.cancelCustomRange();
  }

  private focusDateControl(): void {
    afterNextRender(() => {
      this.datePresets()?.focus();
      this.customStartDate()?.nativeElement.focus();
    }, { injector: this.injector });
  }

  private resetCustomDateForm(): void {
    const now = new Date(this.localDayStartMs());
    const range = activityExplorerDateRange(this.period(), now, this.customDates()) || activityExplorerDateRange(this.defaultPeriod, now)!;
    this.customDateForm.reset({ start: dayjs(range.start), end: dayjs(range.end).subtract(1, 'day') });
  }

  private filtersChanged(): void {
    this.refreshLocalDay();
    this.haptics.selection();
    this.updateUrl();
  }

  private confirmAllDates(feedback = false): void {
    const user = this.user();
    const owner = this.owner;
    if (!user || owner !== this.auth.currentUser || this.allDatesDialog) return;
    if (feedback) this.haptics.selection();
    const dialogRef = this.dialog.open<ConfirmationDialogComponent, ConfirmationDialogData, boolean>(ConfirmationDialogComponent, {
      data: {
        title: 'Load all activity history?',
        message: 'All dates loads your entire activity history. This can be slow and uses more data. Choose a shorter date range for faster loading.',
        confirmText: 'Load all activities',
        cancelText: 'Keep current range',
      },
    });
    this.allDatesDialog = dialogRef;
    dialogRef.afterClosed().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (this.allDatesDialog !== dialogRef) return;
      this.allDatesDialog = undefined;
      if (this.user()?.uid !== user.uid || this.owner !== owner || owner !== this.auth.currentUser) return;
      if (confirmed === true) {
        this.period.set('all');
        this.customDates.set(null);
        this.loadHistory(true);
        // ConfirmationDialogComponent owns feedback for its confirmation button.
        this.updateUrl();
        return;
      }
      // An initial All dates link has not loaded any history yet.
      if (!this.eventsSubscription) this.loadHistory();
      if (this.urlPeriod === 'all') this.updateUrl(true);
    });
  }

  private closeAllDatesWarning(): void {
    const dialogRef = this.allDatesDialog;
    this.allDatesDialog = undefined;
    dialogRef?.close(false);
  }

  private updateUrl(replaceUrl = false): void {
    this.urlPeriod = this.period();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tag: this.selectedTags().length ? this.selectedTags() : null, untagged: this.untagged() ? '1' : null,
        sport: this.selectedSports().length ? this.selectedSports() : null, period: this.period(), order: null,
        start: this.period() === 'custom' ? this.customDates()?.startDate : null,
        end: this.period() === 'custom' ? this.customDates()?.endDate : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  retryActivities(): void {
    if (!this.user() || this.loading() || !this.historyError()) return;
    this.haptics.selection();
    this.loadHistory(true);
  }

  refresh(): void {
    if (!this.user() || this.loading() || this.catalogLoading()) return;
    this.haptics.selection();
    void this.loadCatalog(true);
    this.loadHistory(true);
  }

  retryCatalog(): void {
    if (!this.user() || this.catalogLoading()) return;
    this.haptics.selection();
    void this.loadCatalog(true);
  }

  onEventsChange(changes: EventTableEventsChange): void {
    if (changes.userID !== this.user()?.uid || this.owner !== this.auth.currentUser) return;
    this.catalogTags.set(normalizeEventTagSuggestions([
      ...this.catalogTags(), ...this.library().map(tag => tag.name), ...Object.values(changes.updatedTags).flat(),
    ]));
    // The live date-range query delivers subsequent changes. Reflect this
    // confirmed mutation immediately without restarting the Firestore listener.
    const deleted = new Set(changes.deletedEventIDs);
    this.events.update(events => events.filter(event => !deleted.has(event.getID())).map(event => {
      const tags = changes.updatedTags[event.getID()];
      if (tags) {
        event.tags = tags;
        delete event.benchmarkReviewTags;
      }
      return event;
    }));
  }

  private isCurrent(generation: number, userID: string): boolean {
    return generation === this.generation && this.user()?.uid === userID && this.owner === this.auth.currentUser;
  }

  private async loadCatalog(refresh = false): Promise<void> {
    const user = this.user();
    if (!user || this.catalogLoading()) return;
    const owner = this.owner;
    const version = ++this.catalogVersion;
    const current = () => version === this.catalogVersion && this.user()?.uid === user.uid && owner === this.owner && owner === this.auth.currentUser;
    this.catalogLoading.set(true);
    this.catalogError.set(false);
    try {
      const tags = await this.catalog.listAllTags(user.uid, refresh);
      if (current()) {
        // A tag edit can retain an observed label while this read is in flight.
        this.catalogTags.set(normalizeEventTagSuggestions([...tags, ...this.catalogTags()]));
      }
    } catch (error) {
      if (!current()) return;
      this.catalogError.set(true);
      this.logger.warn('[ActivitiesPage] Could not load saved tags', error);
    } finally {
      if (current()) this.catalogLoading.set(false);
    }
  }

  private loadHistory(feedback = false): void {
    this.localDayStartMs.set(new Date().setHours(0, 0, 0, 0));
    this.generation += 1;
    this.eventsSubscription?.unsubscribe();
    this.events.set([]);
    this.historyError.set(false);
    const user = this.user();
    this.loading.set(!!user);
    if (!user) return;
    const generation = this.generation;
    const range = activityExplorerDateRange(this.period(), new Date(this.localDayStartMs()), this.customDates());
    if (range === undefined) {
      this.loading.set(false);
      return;
    }
    // Match Dashboard's stored numeric date bounds and full selected-range query.
    const where = range ? [
      { fieldPath: 'startDate', opStr: '>=', value: range.start.getTime() },
      { fieldPath: 'startDate', opStr: '<', value: range.end.getTime() },
    ] : [];
    let initial = true;
    this.eventsSubscription = this.eventService.getEventsBy(user, where, 'startDate', false, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: events => {
          if (!this.isCurrent(generation, user.uid)) return;
          this.events.set(events.filter(isNormalActivityEvent));
          this.loading.set(false);
          this.historyError.set(false);
          initial = false;
        },
        error: error => {
          if (!this.isCurrent(generation, user.uid)) return;
          this.loading.set(false);
          this.historyError.set(true);
          this.logger.warn('[ActivitiesPage] Could not load activities', error);
          if (feedback && initial) this.haptics.error();
        },
      });
  }
}
