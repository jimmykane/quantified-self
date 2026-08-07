import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { User } from '@sports-alliance/sports-lib';
import { of, Subject, throwError } from 'rxjs';
import { EventTableModule } from '../../modules/event-table.module';
import { AppEventService } from '../../services/app.event.service';
import { ActivityRangeTableSectionComponent } from './activity-range-table-section.component';

@Component({
  selector: 'app-event-table',
  standalone: true,
  template: '',
})
class EventTableStubComponent {
  @Input() presentation = '';
  @Input() user: User | null = null;
  @Input() targetUser: User | null = null;
  @Input() events: unknown[] = [];
  @Input() showActions = true;
  @Input() isLoading = false;
}

describe('ActivityRangeTableSectionComponent', () => {
  let fixture: ComponentFixture<ActivityRangeTableSectionComponent>;
  const getEventsBy = vi.fn();
  const user = new User('user-1');

  beforeEach(async () => {
    getEventsBy.mockReset();
    await TestBed.configureTestingModule({
      imports: [ActivityRangeTableSectionComponent],
      providers: [{ provide: AppEventService, useValue: { getEventsBy } }],
    }).overrideComponent(ActivityRangeTableSectionComponent, {
      remove: { imports: [EventTableModule] },
      add: { imports: [EventTableStubComponent] },
    }).compileComponents();
    fixture = TestBed.createComponent(ActivityRangeTableSectionComponent);
  });

  it('queries the supplied range and excludes generated records', async () => {
    getEventsBy.mockReturnValue(of([
      event('activity-1'),
      event('merged', { isMerge: true }),
      event('benchmark', { benchmarkResults: { current: {} } }),
    ]));
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('range', {
      startMs: new Date(2026, 7, 1).getTime(),
      endExclusiveMs: new Date(2026, 8, 1).getTime(),
    });
    fixture.componentRef.setInput('periodLabel', 'August 2026');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEventsBy).toHaveBeenCalledWith(user, [{
      fieldPath: 'startDate',
      opStr: '>=',
      value: new Date(2026, 7, 1).getTime(),
    }, {
      fieldPath: 'startDate',
      opStr: '<',
      value: new Date(2026, 8, 1).getTime(),
    }], 'startDate', false, 0);
    expect(fixture.componentInstance.events().map(item => item.getID())).toEqual(['activity-1']);

    const table = fixture.debugElement.query(By.directive(EventTableStubComponent))
      .componentInstance as EventTableStubComponent;
    expect(table.presentation).toBe('browse');
    expect(table.showActions).toBe(false);
  });

  it('queries a target user while preserving the viewer for table preferences', async () => {
    const targetUser = new User('target-user');
    getEventsBy.mockReturnValue(of([event('activity-1')]));
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('targetUser', targetUser);
    fixture.componentRef.setInput('range', {
      startMs: new Date(2026, 7, 1).getTime(),
      endExclusiveMs: new Date(2026, 8, 1).getTime(),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEventsBy).toHaveBeenCalledWith(targetUser, expect.any(Array), 'startDate', false, 0);
    const table = fixture.debugElement.query(By.directive(EventTableStubComponent))
      .componentInstance as EventTableStubComponent;
    expect(table.user).toBe(user);
    expect(table.targetUser).toBe(targetUser);
  });

  it('refreshes the query when the range changes and exposes a contextual error', async () => {
    getEventsBy.mockReturnValueOnce(of([])).mockReturnValueOnce(throwError(() => new Error('offline')));
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('range', {
      startMs: new Date(2026, 7, 1).getTime(),
      endExclusiveMs: new Date(2026, 8, 1).getTime(),
    });
    fixture.componentRef.setInput('periodLabel', 'August 2026');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentRef.setInput('range', {
      startMs: new Date(2026, 8, 1).getTime(),
      endExclusiveMs: new Date(2026, 9, 1).getTime(),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEventsBy).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.hasError()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Activities for August 2026 could not be loaded.');
  });

  it('keeps the loading state visible until the first query result arrives', async () => {
    const response = new Subject<any[]>();
    getEventsBy.mockReturnValue(response);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('range', {
      startMs: new Date(2026, 7, 1).getTime(),
      endExclusiveMs: new Date(2026, 8, 1).getTime(),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.isLoading()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Loading activities');
    expect(fixture.nativeElement.textContent).not.toContain('No activities');

    response.next([]);
    fixture.detectChanges();

    expect(fixture.componentInstance.isReady()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('No activities in this period.');
  });
});

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    getID: () => id,
    ...overrides,
  } as any;
}
