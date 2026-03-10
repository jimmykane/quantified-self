import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { MetricLoaderComponent } from './metric-loader.component';

describe('MetricLoaderComponent', () => {
  let component: MetricLoaderComponent;
  let fixture: ComponentFixture<MetricLoaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MetricLoaderComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(MetricLoaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render four metric counters', () => {
    const counters = fixture.nativeElement.querySelectorAll('.qs-digit-counter');
    expect(counters).toHaveLength(4);
  });

  it('should animate only changed metric digits when value updates', () => {
    (component as any).loaderDigits.ascent = [
      { char: '1', revision: 0 },
      { char: '7', revision: 0 },
      { char: '0', revision: 0 }
    ];

    const didChange = (component as any).applyLoaderDigits('ascent', '171');

    expect(didChange).toBe(true);
    expect((component as any).loaderDigits.ascent).toEqual([
      { char: '1', revision: 0 },
      { char: '7', revision: 0 },
      { char: '1', revision: 1 }
    ]);
  });

  it('should keep distance metric monotonically increasing during loader ticks', () => {
    (component as any).loaderValues.distance = 8.2;
    (component as any).loaderDigits.distance = [
      { char: '8', revision: 0 },
      { char: '.', revision: 0 },
      { char: '2', revision: 0 }
    ];
    (component as any).loaderFrame = 2;

    const changed = (component as any).advanceLoaderMetrics();

    expect(changed).toBe(true);
    expect((component as any).loaderValues.distance).toBe(8.3);
    expect(component.loaderDigits.distance).toEqual([
      { char: '8', revision: 0 },
      { char: '.', revision: 0 },
      { char: '3', revision: 1 }
    ]);
  });
});
