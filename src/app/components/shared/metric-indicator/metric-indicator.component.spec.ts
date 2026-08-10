import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MetricIndicatorComponent } from './metric-indicator.component';

describe('MetricIndicatorComponent', () => {
  let fixture: ComponentFixture<MetricIndicatorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MetricIndicatorComponent] }).compileComponents();
    fixture = TestBed.createComponent(MetricIndicatorComponent);
  });

  it('renders a bounded accessible score', () => {
    fixture.componentRef.setInput('label', 'Sleep quality');
    fixture.componentRef.setInput('value', 80);
    fixture.componentRef.setInput('showThresholds', true);
    fixture.detectChanges();
    const track = fixture.nativeElement.querySelector('[role="progressbar"]');
    expect(track.getAttribute('aria-valuenow')).toBe('80');
    expect(track.getAttribute('aria-label')).toBe('Sleep quality: 80 of 100');
    expect(fixture.nativeElement.querySelector('.metric-indicator-fill').style.width).toBe('80%');
  });

  it('renders signal coverage as discrete segments', () => {
    fixture.componentRef.setInput('variant', 'segments');
    fixture.componentRef.setInput('label', 'Readiness signals');
    fixture.componentRef.setInput('value', 3);
    fixture.componentRef.setInput('total', 4);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.metric-indicator-segments > span.active')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('[role="img"]').getAttribute('aria-label')).toBe('Readiness signals: 3 of 4');
  });

  it('bounds baseline deviations at twenty percent in either direction', () => {
    fixture.componentRef.setInput('variant', 'deviation');
    fixture.componentRef.setInput('value', -30);
    fixture.detectChanges();
    const fill = fixture.nativeElement.querySelector('.metric-indicator-deviation-fill');
    const track = fixture.nativeElement.querySelector('[role="progressbar"]');
    expect(fill.style.left).toBe('0%');
    expect(fill.style.width).toBe('50%');
    expect(track.getAttribute('aria-valuenow')).toBe('-20');
    expect(track.getAttribute('aria-label')).toBe('Metric: -20 percent versus baseline');
  });
});
