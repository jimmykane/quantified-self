import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { WorkoutProfileComponent } from '../plans/workout-profile.component';
import { HomeTrainingPreviewComponent } from './home-training-preview.component';

describe('HomeTrainingPreviewComponent', () => {
  const selection = vi.fn();
  beforeEach(async () => {
    selection.mockClear();
    await TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
      imports: [HomeTrainingPreviewComponent, NoopAnimationsModule],
      providers: [
        { provide: AppHapticsService, useValue: { selection } },
        { provide: EChartsLoaderService, useValue: {
          init: vi.fn().mockResolvedValue({ on: vi.fn(), off: vi.fn(), dispatchAction: vi.fn(), isDisposed: () => false }),
          setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
          subscribeToViewportResize: vi.fn(() => vi.fn()), attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
        } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('keeps initialization silent and preserves completed, planned, skipped and empty sample dates', () => {
    const fixture = TestBed.createComponent(HomeTrainingPreviewComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Completed · activity linked');
    fixture.nativeElement.querySelector('button[aria-label^="Wednesday"]').click();
    fixture.detectChanges();
    expect(component.selected().workout).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Time to recover');
    expect(selection).toHaveBeenCalledOnce();
    component.selectDay(7);
    component.selectDay(99);
    component.selectView('calendar');
    expect(selection).toHaveBeenCalledOnce();
    component.selectDay(9);
    expect(component.selected().status).toBe('Planned');
    component.selectDay(5);
    expect(component.selected().status).toBe('Skipped');
  });

  it('reuses the deferred product profile without changing sample recipes', async () => {
    const fixture = TestBed.createComponent(HomeTrainingPreviewComponent);
    fixture.detectChanges();
    const original = JSON.stringify(fixture.componentInstance.days);
    expect(fixture.debugElement.query(By.directive(WorkoutProfileComponent))).toBeNull();
    fixture.nativeElement.querySelector('.selected-workout button').click();
    fixture.detectChanges();
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);
    fixture.detectChanges();
    const profile = fixture.debugElement.query(By.directive(WorkoutProfileComponent)).componentInstance;
    expect(profile.structure()).toBe(fixture.componentInstance.selected().workout?.structure);
    expect(profile.model()?.metrics).toContain('power');
    expect(JSON.stringify(fixture.componentInstance.days)).toBe(original);
    expect(selection).toHaveBeenCalledOnce();
    fixture.componentInstance.selectView('profile');
    expect(selection).toHaveBeenCalledOnce();
  });

  it('formats prescription totals through canonical metric and imperial unit preferences', () => {
    const fixture = TestBed.createComponent(HomeTrainingPreviewComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectDay(10);
    expect(fixture.componentInstance.totals()).toContain('10.00 Km');
    fixture.componentRef.setInput('unitSettings', { distanceUnits: DistanceUnits.Miles });
    fixture.detectChanges();
    expect(fixture.componentInstance.totals()).toContain('mi prescribed');
    expect(fixture.componentInstance.selected().workout?.structure.nodes[0]).toMatchObject({ ending: { kind: 'distance', meters: 10000 } });
  });
});
