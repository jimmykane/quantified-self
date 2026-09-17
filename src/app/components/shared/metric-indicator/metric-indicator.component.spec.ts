import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MetricIndicatorComponent } from './metric-indicator.component';

describe('MetricIndicatorComponent', () => {
  let fixture: ComponentFixture<MetricIndicatorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MetricIndicatorComponent] }).compileComponents();
    fixture = TestBed.createComponent(MetricIndicatorComponent);
  });

  it('renders a bounded accessible score', () => {
    fixture.componentRef.setInput('label', 'Readiness');
    fixture.componentRef.setInput('value', 76);
    fixture.componentRef.setInput('tone', 'ready');
    fixture.componentRef.setInput('showThresholds', true);
    fixture.detectChanges();
    const track = fixture.nativeElement.querySelector('[role="progressbar"]');
    const fill = fixture.nativeElement.querySelector('.metric-indicator-fill');
    expect(track.getAttribute('aria-valuenow')).toBe('76');
    expect(track.getAttribute('aria-label')).toBe('Readiness: 76 of 100');
    expect(fill.style.width).toBe('76%');
    expect(fill.getAttribute('data-tone')).toBe('ready');
    expect(fixture.nativeElement.querySelectorAll('.metric-indicator-threshold')).toHaveLength(2);
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

  it('renders a value against an accessible personal range', () => {
    fixture.componentRef.setInput('variant', 'range');
    fixture.componentRef.setInput('label', 'HRV');
    fixture.componentRef.setInput('value', 30);
    fixture.componentRef.setInput('min', 25);
    fixture.componentRef.setInput('max', 50);
    fixture.componentRef.setInput('rangeMin', 33);
    fixture.componentRef.setInput('rangeMax', 45);
    fixture.componentRef.setInput('valueText', '30 ms');
    fixture.componentRef.setInput('rangeText', '60-day range 33–45 ms');
    fixture.componentRef.setInput('tone', 'negative');
    fixture.detectChanges();

    const indicator = fixture.nativeElement.querySelector('.metric-indicator-range');
    const band = fixture.nativeElement.querySelector('.metric-indicator-range-band');
    const marker = fixture.nativeElement.querySelector('.metric-indicator-range-marker');
    expect(indicator.getAttribute('aria-label')).toBe('HRV: 30 ms; 60-day range 33–45 ms');
    expect(band.style.left).toBe('32%');
    expect(band.style.width).toBe('48%');
    expect(marker.style.left).toBe('20%');
    expect(marker.getAttribute('data-tone')).toBe('negative');
  });
});
