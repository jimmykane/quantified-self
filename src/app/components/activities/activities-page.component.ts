import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, combineLatest, firstValueFrom, of } from 'rxjs';
import { normalizeEventTags, normalizeEventTagSuggestions } from '@shared/event-tags';
import type { AppEventInterface } from '@shared/app-event.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import type { AppUserInterface } from '../../models/app-user.interface';
import type { FirebaseUserType } from '../../firebase/auth';
import { buildEventTagLibrary } from '../../helpers/event-tag-library.helper';
import { activityExplorerSports, filterActivityExplorerEvents, type ActivityExplorerPeriod } from '../../helpers/activity-explorer.helper';
import { isNormalActivityEvent } from '../../helpers/normal-activity-event.helper';
import type { EventTableEventsChange } from '../event-table/event.table.component';
import { EventTableModule } from '../../modules/event-table.module';
import { SharedModule } from '../../modules/shared.module';
import { AppEventService, type EventQueryCursor } from '../../services/app.event.service';
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';

interface PendingPageChanges {
  updatedTags: Map<string, string[]>;
  deletedIDs: Set<string>;
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
  private owner: FirebaseUserType | null = null;
  private generation = 0;
  private cursor: EventQueryCursor | null = null;
  private pendingPageChanges: PendingPageChanges | null = null;
  readonly user = signal<AppUserInterface | null>(null);
  readonly tableUsers = computed(() => { const user = this.user(); return user ? [user] : []; });
  readonly events = signal<AppEventInterface[]>([]);
  readonly catalogTags = signal<string[]>([]);
  readonly selectedTag = signal('');
  readonly selectedSport = signal('');
  readonly period = signal<ActivityExplorerPeriod>('all');
  readonly untagged = signal(false);
  readonly untaggedOption = { untagged: true } as const;
  readonly loading = signal(false);
  readonly catalogLoading = signal(false);
  readonly historyLoaded = signal(false);
  readonly hasMore = signal(true);
  readonly historyError = signal(false);
  readonly catalogError = signal(false);
  readonly library = computed(() => buildEventTagLibrary(this.events(), this.catalogTags(), this.selectedTag()));
  readonly selectedKey = computed(() => this.selectedTag().toLowerCase());
  readonly selectedName = computed(() => this.library().find(tag => tag.key === this.selectedKey())?.name || this.selectedTag());
  readonly tagFilterValue = computed(() => this.untagged() ? this.untaggedOption : this.selectedName());
  readonly sports = computed(() => activityExplorerSports(this.events(), this.selectedSport()));
  readonly filters = computed(() => ({
    tag: this.selectedTag(), untagged: this.untagged(), sport: this.selectedSport(), period: this.period(),
  }));
  readonly filterContext = computed(() => JSON.stringify(this.filters()));
  readonly hasFilters = computed(() => !!this.selectedTag() || this.untagged() || !!this.selectedSport() || this.period() !== 'all');
  // A fresh owner input also refreshes the shared table's unit-aware row cache.
  readonly filteredEvents = computed(() => this.user() ? filterActivityExplorerEvents(this.events(), this.filters()) : []);
  readonly complete = computed(() => this.historyLoaded() && !this.hasMore() && !this.historyError());
  readonly emptyMessage = computed(() => this.complete()
    ? this.selectedSport() || this.period() !== 'all' ? 'No activities match these filters'
      : this.untagged() ? 'No untagged activities' : this.selectedTag() ? 'No activities with this tag' : 'No activities yet'
    : 'No matching activities loaded yet');
  readonly emptyHint = computed(() => this.complete()
    ? this.hasFilters() ? 'Clear a filter to see more activities.' : 'Import an activity to get started.'
    : 'Load older activities to look further back in your history.');

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => { this.generation += 1; this.pendingPageChanges = null; });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tag = normalizeEventTagSuggestions([params.get('tag')])[0] || '';
      this.selectedTag.set(tag);
      this.untagged.set(!tag && params.get('untagged') === '1');
      this.selectedSport.set((params.get('sport') || '').trim().slice(0, 100));
      this.period.set(params.get('period') === 'week' ? 'week' : 'all');
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
        this.resetHistory();
        if (nextUser) {
          void this.loadCatalog();
          void this.loadPage();
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
    if (sport === this.selectedSport()) return;
    this.selectedSport.set(sport);
    this.filtersChanged();
  }

  selectPeriod(period: ActivityExplorerPeriod): void {
    if (period === this.period()) return;
    this.period.set(period);
    this.filtersChanged();
  }

  clearFilters(): void {
    if (!this.hasFilters()) return;
    this.selectedTag.set('');
    this.untagged.set(false);
    this.selectedSport.set('');
    this.period.set('all');
    this.filtersChanged();
  }

  private filtersChanged(): void {
    this.haptics.selection();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tag: this.selectedTag() || null, untagged: this.untagged() ? '1' : null,
        sport: this.selectedSport() || null, period: this.period() === 'all' ? null : this.period(),
      },
      queryParamsHandling: 'merge',
    });
  }

  async loadOlderActivities(): Promise<void> {
    if (!this.user() || this.loading() || !this.hasMore()) return;
    this.haptics.selection();
    await this.loadPage(true);
  }

  refresh(): void {
    if (!this.user() || this.loading() || this.catalogLoading()) return;
    this.haptics.selection();
    this.resetHistory();
    void this.loadCatalog(true);
    void this.loadPage();
  }

  retryCatalog(): void {
    if (!this.user() || this.catalogLoading()) return;
    this.haptics.selection();
    void this.loadCatalog(true);
  }

  onEventsChange(changes: EventTableEventsChange): void {
    if (changes.userID !== this.user()?.uid || this.owner !== this.auth.currentUser) return;
    const knownTags = this.library().map(tag => tag.name);
    const deletedIDs = new Set(changes.deletedEventIDs);
    const updatedTags = new Map<string, string[]>(Object.entries(changes.updatedTags)
      .map(([eventID, tags]) => [eventID, normalizeEventTags(tags)]));
    // Protect only the read already in flight, without masking later server reads.
    if (this.pendingPageChanges) {
      deletedIDs.forEach(eventID => this.pendingPageChanges.deletedIDs.add(eventID));
      updatedTags.forEach((tags, eventID) => this.pendingPageChanges.updatedTags.set(eventID, tags));
    }
    const events = this.events().filter(event => !deletedIDs.has(event.getID()));
    for (const event of events) {
      const tags = updatedTags.get(event.getID());
      if (!tags) continue;
      // Keep Sports Lib instances and newer metadata; only the confirmed fields changed.
      event.tags = [...tags];
      delete event.benchmarkReviewTags;
    }
    this.events.set(events);
    // Keep a newly created label visible after its last matching row leaves the table.
    this.catalogTags.set(normalizeEventTagSuggestions([
      ...this.catalogTags(), ...knownTags, ...this.library().map(tag => tag.name), ...[...updatedTags.values()].flat(),
    ]));
  }

  private resetHistory(): void {
    this.generation += 1;
    this.cursor = null;
    this.pendingPageChanges = null;
    this.events.set([]);
    this.catalogTags.set([]);
    this.loading.set(false);
    this.catalogLoading.set(false);
    this.historyLoaded.set(false);
    this.hasMore.set(true);
    this.historyError.set(false);
    this.catalogError.set(false);
  }

  private isCurrent(generation: number, userID: string): boolean {
    return generation === this.generation && this.user()?.uid === userID && this.owner === this.auth.currentUser;
  }

  private async loadCatalog(refresh = false): Promise<void> {
    const user = this.user();
    if (!user || this.catalogLoading()) return;
    const generation = this.generation;
    this.catalogLoading.set(true);
    this.catalogError.set(false);
    try {
      const tags = await this.catalog.listAllTags(user.uid, refresh);
      if (this.isCurrent(generation, user.uid)) {
        // A tag edit can retain an observed label while this read is in flight.
        this.catalogTags.set(normalizeEventTagSuggestions([...tags, ...this.catalogTags()]));
      }
    } catch (error) {
      if (!this.isCurrent(generation, user.uid)) return;
      this.catalogError.set(true);
      this.logger.warn('[ActivitiesPage] Could not load saved tags', error);
    } finally {
      if (this.isCurrent(generation, user.uid)) this.catalogLoading.set(false);
    }
  }

  private async loadPage(feedback = false): Promise<void> {
    const user = this.user();
    if (!user || this.loading() || !this.hasMore()) return;
    const generation = this.generation;
    const pendingChanges: PendingPageChanges = { updatedTags: new Map(), deletedIDs: new Set() };
    this.pendingPageChanges = pendingChanges;
    this.loading.set(true);
    this.historyError.set(false);
    try {
      const page = await firstValueFrom(this.eventService.getEventsPageOnceByWithMeta(
        user, [], 'startDate', false, 250, { startAfterCursor: this.cursor, requireServer: true },
      ).pipe(catchError(error => of({ error }))));
      if (!this.isCurrent(generation, user.uid)) return;
      if ('error' in page) throw page.error;
      const eventsByID = new Map(this.events().map(event => [event.getID(), event]));
      page.events.forEach(event => {
        if (!isNormalActivityEvent(event)) return;
        const eventID = event.getID();
        if (pendingChanges.deletedIDs.has(eventID)) return;
        const savedTags = pendingChanges.updatedTags.get(eventID);
        if (savedTags) {
          event.tags = [...savedTags];
          delete event.benchmarkReviewTags;
        }
        eventsByID.set(eventID, event);
      });
      this.events.set([...eventsByID.values()]);
      this.cursor = page.lastCursor;
      this.hasMore.set(page.hasMore);
      this.historyLoaded.set(true);
    } catch (error) {
      if (!this.isCurrent(generation, user.uid)) return;
      this.historyError.set(true);
      this.logger.warn('[ActivitiesPage] Could not load activities', error);
      if (feedback) this.haptics.error();
    } finally {
      if (this.isCurrent(generation, user.uid)) {
        this.pendingPageChanges = null;
        this.loading.set(false);
      }
    }
  }
}
