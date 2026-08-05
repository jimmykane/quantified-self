import { TestBed } from '@angular/core/testing';
import { ActivityCalendarVolumeListComponent } from './activity-calendar-volume-list.component';

describe('ActivityCalendarVolumeListComponent', () => {
  it('renders shared duration bars and available statistics', async () => {
    await TestBed.configureTestingModule({
      imports: [ActivityCalendarVolumeListComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ActivityCalendarVolumeListComponent);
    fixture.componentRef.setInput('rows', [{
      id: 'running',
      label: 'Running',
      icon: 'directions_run',
      color: '#16b4ea',
      eventCountLabel: '1 activity',
      value: 3600,
      maximumValue: 3600,
      valueLabel: '1h',
      barPercent: 100,
      hasData: true,
      progressLabel: 'Running Duration',
      ariaLabel: 'Running, 1 activity, Duration 1h',
      stats: [
        { metric: 'duration', icon: 'schedule', valueLabel: '1h', isBarMetric: true, ariaLabel: 'Duration 1h' },
        { metric: 'distance', icon: 'route', valueLabel: '10.00 Km', isBarMetric: false, ariaLabel: 'Distance 10.00 Km' },
      ],
    }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.calendar-family-volume-track')?.getAttribute('role'))
      .toBe('progressbar');
    expect((fixture.nativeElement.querySelector('.calendar-family-volume-fill') as HTMLElement)?.style.width)
      .toBe('100%');
    expect([...fixture.nativeElement.querySelectorAll('.calendar-family-volume-stat')]
      .map((stat: HTMLElement) => stat.getAttribute('aria-label'))).toEqual([
      'Duration 1h',
      'Distance 10.00 Km',
    ]);
  });
});
