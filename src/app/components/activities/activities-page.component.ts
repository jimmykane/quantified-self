import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';
import { normalizeEventTagSuggestions } from '@shared/event-tags';
import type { AppEventInterface } from '@shared/app-event.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import type { AppUserInterface } from '../../models/app-user.interface';
import type { FirebaseUserType } from '../../firebase/auth';
import { buildEventTagLibrary } from '../../helpers/event-tag-library.helper';
import { ACTIVITY_EXPLORER_PERIODS, activityExplorerDateRange, activityExplorerSports, filterActivityExplorerEvents, normalizeActivityExplorerSport, type ActivityExplorerPeriod } from '../../helpers/activity-explorer.helper';
import { isNormalActivityEvent } from '../../helpers/normal-activity-event.helper';
import type { EventTableEventsChange } from '../event-table/event.table.component';
import { EventTableModule } from '../../modules/event-table.module';
import { SharedModule } from '../../modules/shared.module';
import { AppEventService } from '../../services/app.event.service';
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-activities-page',
  standalone: true,
  imports: [SharedModule, EventTableModule],
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly localDayStartMs = signal(new Date().setHours(0, 0, 0, 0));
  private owner: FirebaseUserType | null = null;
  private generation = 0;
  private eventsSubscription?: Subscription;
  private catalogVersion = 0;
  readonly user = signal<AppUserInterface | null>(null);
  readonly tableUsers = computed(() => { const user = this.user(); return user ? [user] : []; });
  readonly events = signal<AppEventInterface[]>([]);
  readonly catalogTags = signal<string[]>([]);
  readonly selectedTag = signal('');
  readonly selectedSport = signal('');
  readonly periods = ACTIVITY_EXPLORER_PERIODS;
  readonly defaultPeriod: ActivityExplorerPeriod = 'month';
  readonly period = signal<ActivityExplorerPeriod>(this.defaultPeriod);
  readonly periodLabel = computed(() => this.periods.find(period => period.value === this.period())!.label);
  readonly untagged = signal(false);
  readonly untaggedOption = { untagged: true } as const;
  readonly loading = signal(false);
  readonly catalogLoading = signal(false);
  readonly historyError = signal(false);
  readonly catalogError = signal(false);
  readonly library = computed(() => buildEventTagLibrary(this.events(), this.catalogTags(), this.selectedTag()));
  readonly selectedKey = computed(() => this.selectedTag().toLowerCase());
  readonly selectedName = computed(() => this.library().find(tag => tag.key === this.selectedKey())?.name || this.selectedTag());
  readonly tagFilterValue = computed(() => this.untagged() ? this.untaggedOption : this.selectedName());
  readonly sports = computed(() => activityExplorerSports(this.events(), this.selectedSport(), true));
  readonly filters = computed(() => ({
    tag: this.selectedTag(), untagged: this.untagged(), sport: this.selectedSport(), period: this.period(),
  }));
  readonly filterContext = computed(() => JSON.stringify(this.filters()));
  readonly hasFilters = computed(() => !!this.selectedTag() || this.untagged() || !!this.selectedSport() || this.period() !== this.defaultPeriod);
  readonly filteredEvents = computed(() => this.user()
    ? filterActivityExplorerEvents(this.events(), this.filters(), new Date(this.localDayStartMs())) : []);
  readonly emptyMessage = computed(() => this.loading() ? 'Loading activities…'
    : this.historyError() ? 'Activities couldn’t be loaded'
      : this.selectedSport() ? 'No activities match these filters'
        : this.untagged() ? 'No untagged activities' : this.selectedTag() ? 'No activities with this tag' : 'No activities in this date range');
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
    if (this.user() && this.period() !== 'all') this.loadHistory();
  }

  @HostListener('document:visibilitychange')
  refreshVisibleLocalDay(): void {
    if (this.document.visibilityState === 'visible') this.refreshLocalDay();
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => { this.generation += 1; this.catalogVersion += 1; this.eventsSubscription?.unsubscribe(); });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const previousPeriod = this.period();
      const tag = normalizeEventTagSuggestions([params.get('tag')])[0] || '';
      this.selectedTag.set(tag);
      this.untagged.set(!tag && params.get('untagged') === '1');
      this.selectedSport.set(normalizeActivityExplorerSport((params.get('sport') || '').trim().slice(0, 100)));
      const period = this.periods.find(period => period.value === params.get('period'))?.value || this.defaultPeriod;
      this.period.set(period);
      if (previousPeriod !== this.period() && this.user()) this.loadHistory();
      else this.refreshLocalDay();
    });
    combineLatest([this.auth.user$, this.auth.authState$]).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([profile, owner]) => {
        const nextUser = owner && profile?.uid === owner.uid ? profile : null;
        if (nextUser?.uid === this.user()?.uid && owner === this.owner) {
          this.user.set(nextUser);
          return;
        }
        this.owner = owner;
        this.user.set(nextUser);
        this.catalogVersion += 1;
        this.catalogTags.set([]);
        this.catalogLoading.set(false);
        this.catalogError.set(false);
        this.generation += 1;
        this.eventsSubscription?.unsubscribe();
        this.events.set([]);
        this.loading.set(false);
        this.historyError.set(false);
        if (nextUser) {
          void this.loadCatalog();
          this.loadHistory();
        }
      });
  }

  selectTag(tag: string | typeof this.untaggedOption): void {
    const untagged = typeof tag !== 'string';
    const next = untagged ? '' : normalizeEventTagSuggestions([tag])[0] || '';
    if (next.toLowerCase() === this.selectedKey() && untagged === this.untagged()) return;
    this.selectedTag.set(next);
    this.untagged.set(untagged);
    this.filtersChanged();
  }

  selectSport(sport: string): void {
    const next = normalizeActivityExplorerSport(sport);
    if (next === this.selectedSport()) return;
    this.selectedSport.set(next);
    this.filtersChanged();
  }

  selectPeriod(period: ActivityExplorerPeriod): void {
    if (period === this.period()) return;
    this.period.set(period);
    this.loadHistory(true);
    this.filtersChanged();
  }

  clearFilters(): void {
    if (!this.hasFilters()) return;
    this.selectedTag.set('');
    this.untagged.set(false);
    this.selectedSport.set('');
    const periodChanged = this.period() !== this.defaultPeriod;
    this.period.set(this.defaultPeriod);
    if (periodChanged) this.loadHistory(true);
    this.filtersChanged();
  }

  private filtersChanged(): void {
    this.refreshLocalDay();
    this.haptics.selection();
    this.updateUrl();
  }

  private updateUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tag: this.selectedTag() || null, untagged: this.untagged() ? '1' : null,
        sport: this.selectedSport() || null, period: this.period(), order: null,
      },
      queryParamsHandling: 'merge',
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
    const range = activityExplorerDateRange(this.period(), new Date(this.localDayStartMs()));
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
