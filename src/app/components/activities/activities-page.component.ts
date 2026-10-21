import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import type { PageEvent } from '@angular/material/paginator';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, combineLatest, firstValueFrom, of } from 'rxjs';
import { normalizeEventTagSuggestions } from '@shared/event-tags';
import type { AppEventInterface } from '@shared/app-event.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import type { AppUserInterface } from '../../models/app-user.interface';
import type { FirebaseUserType } from '../../firebase/auth';
import { buildEventTagLibrary } from '../../helpers/event-tag-library.helper';
import { ACTIVITY_EXPLORER_PERIODS, activityExplorerDateRange, activityExplorerMatchesSearch, activityExplorerSports, filterActivityExplorerEvents, normalizeActivityExplorerSport, type ActivityExplorerPeriod } from '../../helpers/activity-explorer.helper';
import { isNormalActivityEvent } from '../../helpers/normal-activity-event.helper';
import type { EventTableEventsChange, EventTablePagination } from '../event-table/event.table.component';
import { EventTableModule } from '../../modules/event-table.module';
import { SharedModule } from '../../modules/shared.module';
import { AppEventService, type EventQueryCursor } from '../../services/app.event.service';
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';

interface ActivityPage {
  events: AppEventInterface[];
  hasNext: boolean;
}

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
  private cursor: EventQueryCursor | null = null;
  private remaining: AppEventInterface[] = [];
  private sourceHasMore = true;
  private requestedPage = 0;
  private seenIDs = new Set<string>();
  private readonly pages = new Map<number, ActivityPage>();
  private catalogVersion = 0;
  readonly user = signal<AppUserInterface | null>(null);
  readonly tableUsers = computed(() => { const user = this.user(); return user ? [user] : []; });
  readonly events = signal<AppEventInterface[]>([]);
  readonly catalogTags = signal<string[]>([]);
  readonly selectedTag = signal('');
  readonly selectedSport = signal('');
  readonly periods = ACTIVITY_EXPLORER_PERIODS;
  readonly period = signal<ActivityExplorerPeriod>('all');
  readonly pageIndex = signal(0);
  readonly pageSize = signal(25);
  readonly direction = signal<'asc' | 'desc'>('desc');
  readonly searchTerm = signal('');
  readonly pagination = computed<EventTablePagination>(() => ({ pageIndex: this.pageIndex(), pageSize: this.pageSize(), hasNext: this.hasMore(), direction: this.direction() }));
  readonly periodLabel = computed(() => this.periods.find(period => period.value === this.period())!.label);
  readonly untagged = signal(false);
  readonly untaggedOption = { untagged: true } as const;
  readonly loading = signal(false);
  readonly catalogLoading = signal(false);
  readonly historyLoaded = signal(false);
  readonly hasMore = signal(false);
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
  readonly filterContext = computed(() => JSON.stringify({ ...this.filters(), direction: this.direction() }));
  readonly hasFilters = computed(() => !!this.selectedTag() || this.untagged() || !!this.selectedSport() || this.period() !== 'all');
  readonly filteredEvents = computed(() => this.user() ? [...this.events()] : []);
  readonly complete = computed(() => this.historyLoaded() && !this.loading() && !this.historyError());
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
    if (this.user() && this.period() !== 'all') this.restartHistory();
  }

  @HostListener('document:visibilitychange')
  refreshVisibleLocalDay(): void {
    if (this.document.visibilityState === 'visible') this.refreshLocalDay();
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => { this.generation += 1; this.catalogVersion += 1; });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.refreshLocalDay();
      const previousFilters = this.filterContext();
      const tag = normalizeEventTagSuggestions([params.get('tag')])[0] || '';
      this.selectedTag.set(tag);
      this.untagged.set(!tag && params.get('untagged') === '1');
      this.selectedSport.set(normalizeActivityExplorerSport((params.get('sport') || '').trim().slice(0, 100)));
      const period = this.periods.find(period => period.value === params.get('period'))?.value || 'all';
      this.period.set(period);
      this.direction.set(params.get('order') === 'asc' ? 'asc' : 'desc');
      if (previousFilters !== this.filterContext() && this.user()) this.restartHistory();
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
        this.searchTerm.set('');
        this.pageSize.set(this.normalizePageSize(nextUser?.settings?.dashboardSettings?.tableSettings?.eventsPerPage || 25));
        this.resetHistory();
        if (nextUser) {
          void this.loadCatalog();
          void this.loadPage(0);
        }
      });
  }

  selectTag(tag: string | typeof this.untaggedOption): void {
    const untagged = typeof tag !== 'string';
    const next = untagged ? '' : normalizeEventTagSuggestions([tag])[0] || '';
    if (next.toLowerCase() === this.selectedKey() && untagged === this.untagged()) return;
    this.selectedTag.set(next);
    this.untagged.set(untagged);
    this.restartHistory(true);
    this.filtersChanged();
  }

  selectSport(sport: string): void {
    const next = normalizeActivityExplorerSport(sport);
    if (next === this.selectedSport()) return;
    this.selectedSport.set(next);
    this.restartHistory(true);
    this.filtersChanged();
  }

  selectPeriod(period: ActivityExplorerPeriod): void {
    if (period === this.period()) return;
    this.period.set(period);
    this.restartHistory(true);
    this.filtersChanged();
  }

  clearFilters(): void {
    if (!this.hasFilters()) return;
    this.selectedTag.set('');
    this.untagged.set(false);
    this.selectedSport.set('');
    this.period.set('all');
    this.restartHistory(true);
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
        sport: this.selectedSport() || null, period: this.period(), order: this.direction() === 'asc' ? 'asc' : null,
      },
      queryParamsHandling: 'merge',
    });
  }

  async retryActivities(): Promise<void> {
    if (!this.user() || this.loading() || !this.historyError()) return;
    this.haptics.selection();
    await this.loadPage(this.requestedPage, true);
  }

  private restartHistory(feedback = false): void {
    this.resetHistory();
    if (!this.user()) return;
    void this.loadPage(0, feedback);
  }

  refresh(): void {
    if (!this.user() || this.loading() || this.catalogLoading()) return;
    this.refreshLocalDay();
    this.haptics.selection();
    this.resetHistory();
    void this.loadCatalog(true);
    void this.loadPage(0, true);
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
    // Requery after the confirmed write. Any page read started before it is fenced out.
    this.restartHistory();
  }

  onPageRequest(page: PageEvent): void {
    const size = this.normalizePageSize(page.pageSize);
    if (size !== this.pageSize()) {
      this.pageSize.set(size);
      this.restartHistory(true);
      return;
    }
    if (page.pageIndex < 0 || page.pageIndex === this.pageIndex() || this.loading()) return;
    if (!this.pages.has(page.pageIndex) && (page.pageIndex !== this.pageIndex() + 1 || !this.hasMore())) return;
    void this.loadPage(page.pageIndex, true);
  }

  onSearchChange(search: string): void {
    if (search.trim().toLowerCase() === this.searchTerm().trim().toLowerCase()) return;
    this.searchTerm.set(search);
    this.restartHistory();
  }

  onDateSortChange(direction: 'asc' | 'desc'): void {
    if (direction === this.direction()) return;
    this.direction.set(direction);
    this.restartHistory(true);
    this.updateUrl();
  }

  private normalizePageSize(size: number): number {
    return [10, 25, 50, 100, 250].includes(size) ? size : 25;
  }

  private resetHistory(): void {
    this.generation += 1;
    this.cursor = null;
    this.remaining = [];
    this.sourceHasMore = true;
    this.requestedPage = 0;
    this.seenIDs.clear();
    this.pages.clear();
    this.events.set([]);
    this.pageIndex.set(0);
    this.loading.set(false);
    this.historyLoaded.set(false);
    this.hasMore.set(false);
    this.historyError.set(false);
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

  private async loadPage(index: number, feedback = false): Promise<void> {
    const user = this.user();
    if (!user || this.loading()) return;
    this.requestedPage = index;
    const cached = this.pages.get(index);
    if (cached) {
      this.showPage(index, cached);
      return;
    }
    const generation = this.generation;
    const now = new Date(this.localDayStartMs());
    const filters = this.filters();
    const search = this.searchTerm();
    const size = this.pageSize();
    const range = activityExplorerDateRange(filters.period, now);
    const where = range ? [
      { fieldPath: 'startDate', opStr: '>=', value: range.start },
      { fieldPath: 'startDate', opStr: '<', value: range.end },
    ] : [];
    let cursor = this.cursor;
    let more = this.sourceHasMore;
    const matches = [...this.remaining];
    const seenIDs = new Set(this.seenIDs);
    this.loading.set(true);
    this.historyError.set(false);
    try {
      // One matching lookahead enables Next without a guessed total or an empty last page.
      while (matches.length <= size && more) {
        const page = await firstValueFrom(this.eventService.getEventsPageOnceByWithMeta(
          user, where, 'startDate', this.direction() === 'asc', 250,
          { startAfterCursor: cursor, requireServer: true },
        ).pipe(catchError(error => of({ error }))));
        if (!this.isCurrent(generation, user.uid)) return;
        if ('error' in page) throw page.error;
        if (page.hasMore && (!page.lastCursor || page.lastCursor.id === cursor?.id)) {
          throw new Error('Activity history pagination did not advance.');
        }
        const unseen = page.events.filter(isNormalActivityEvent).filter(event => {
          const id = event.getID();
          if (seenIDs.has(id)) return false;
          seenIDs.add(id);
          return true;
        });
        matches.push(...filterActivityExplorerEvents(unseen, filters, now)
          .filter(event => activityExplorerMatchesSearch(event, search)));
        cursor = page.lastCursor;
        more = page.hasMore;
      }
      const page = { events: matches.splice(0, size), hasNext: matches.length > 0 };
      this.cursor = cursor;
      this.sourceHasMore = more;
      this.remaining = matches;
      this.seenIDs = seenIDs;
      this.pages.set(index, page);
      this.showPage(index, page);
    } catch (error) {
      if (!this.isCurrent(generation, user.uid)) return;
      this.historyError.set(true);
      this.logger.warn('[ActivitiesPage] Could not load activities', error);
      if (feedback) this.haptics.error();
    } finally {
      if (this.isCurrent(generation, user.uid)) this.loading.set(false);
    }
  }

  private showPage(index: number, page: ActivityPage): void {
    this.pageIndex.set(index);
    this.events.set([...page.events]);
    this.hasMore.set(page.hasNext);
    this.historyLoaded.set(true);
    this.historyError.set(false);
  }
}
