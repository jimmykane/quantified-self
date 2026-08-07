import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { EventInterface, User } from '@sports-alliance/sports-lib';
import { catchError, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { isNormalActivityEvent } from '../../helpers/normal-activity-event.helper';
import type { ActivityRange } from '../../models/activity-range.interface';
import { EventTableModule } from '../../modules/event-table.module';
import { SharedModule } from '../../modules/shared.module';
import { AppEventService } from '../../services/app.event.service';

interface ActivityRangeTableState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  events: EventInterface[];
}

interface ActivityRangeTableRequest {
  queryUser: User | null;
  range: ActivityRange | null;
  reloadSequence: number;
}

@Component({
  selector: 'app-activity-range-table-section',
  standalone: true,
  imports: [SharedModule, EventTableModule],
  templateUrl: './activity-range-table-section.component.html',
  styleUrls: ['./activity-range-table-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityRangeTableSectionComponent {
  private readonly eventService = inject(AppEventService);
  private readonly reloadSequence = signal(0);

  readonly user = input<User | null>(null);
  readonly targetUser = input<User | null>(null);
  readonly range = input<ActivityRange | null>(null);
  readonly heading = input('Activities');
  readonly periodLabel = input('');
  readonly emptyMessage = input<string | null>(null);
  readonly errorMessage = input<string | null>(null);

  private readonly request = computed<ActivityRangeTableRequest>(() => ({
    queryUser: this.targetUser() || this.user(),
    range: this.range(),
    reloadSequence: this.reloadSequence(),
  }));

  readonly state = toSignal(toObservable(this.request).pipe(
    distinctUntilChanged((previous, current) => (
      previous.queryUser?.uid === current.queryUser?.uid
      && previous.range?.startMs === current.range?.startMs
      && previous.range?.endExclusiveMs === current.range?.endExclusiveMs
      && previous.reloadSequence === current.reloadSequence
    )),
    switchMap(request => {
      if (!request.queryUser || !isValidActivityRange(request.range)) {
        return of({ status: 'idle', events: [] } as ActivityRangeTableState);
      }

      return this.eventService.getEventsBy(request.queryUser, [{
        fieldPath: 'startDate',
        opStr: '>=',
        value: request.range.startMs,
      }, {
        fieldPath: 'startDate',
        opStr: '<',
        value: request.range.endExclusiveMs,
      }], 'startDate', false, 0).pipe(
        map(events => ({
          status: 'ready',
          events: (events || []).filter(isNormalActivityEvent),
        }) as ActivityRangeTableState),
        startWith({ status: 'loading', events: [] } as ActivityRangeTableState),
        catchError(() => of({ status: 'error', events: [] } as ActivityRangeTableState)),
      );
    }),
  ), { initialValue: { status: 'loading', events: [] } as ActivityRangeTableState });

  readonly isLoading = computed(() => this.state().status === 'loading');
  readonly isReady = computed(() => this.state().status === 'ready');
  readonly hasError = computed(() => this.state().status === 'error');
  readonly events = computed(() => this.state().events);
  readonly resolvedEmptyMessage = computed(() => (
    this.emptyMessage() || `No activities in ${this.periodLabel() || 'this period'}.`
  ));
  readonly resolvedErrorMessage = computed(() => (
    this.errorMessage() || `Activities for ${this.periodLabel() || 'this period'} could not be loaded.`
  ));

  retry(): void {
    this.reloadSequence.update(value => value + 1);
  }
}

function isValidActivityRange(range: ActivityRange | null): range is ActivityRange {
  return !!range
    && Number.isFinite(range.startMs)
    && Number.isFinite(range.endExclusiveMs)
    && range.endExclusiveMs > range.startMs;
}
