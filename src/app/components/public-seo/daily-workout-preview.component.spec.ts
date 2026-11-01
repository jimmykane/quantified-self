import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonToggle } from '@angular/material/button-toggle';
import { DistanceUnits, PaceUnits } from '@sports-alliance/sports-lib';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { WorkoutProfileComponent } from '../plans/workout-profile.component';
import { DailyWorkoutPreviewComponent } from './daily-workout-preview.component';

describe('DailyWorkoutPreviewComponent', () => {
  async function setup() {
    const selection = vi.fn();
    await TestBed.configureTestingModule({ imports: [DailyWorkoutPreviewComponent, NoopAnimationsModule], providers: [
      { provide: AppHapticsService, useValue: { selection } },
      { provide: EChartsLoaderService, useValue: { init: vi.fn().mockResolvedValue({ on: vi.fn(), off: vi.fn(),
        dispatchAction: vi.fn(), isDisposed: () => false }), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
        subscribeToViewportResize: vi.fn(() => vi.fn()), attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()) } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(DailyWorkoutPreviewComponent);
    fixture.detectChanges(); await fixture.whenStable();
    return { fixture, selection };
  }
  it('uses only sample context and opens the shared workout profile on explicit review', async () => {
    const { fixture, selection } = await setup();
    expect(selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Sample data · Nothing is saved');
    expect(fixture.nativeElement.textContent).toContain('Easy run · 30m 00s');
    expect(fixture.debugElement.query(By.directive(WorkoutProfileComponent))).toBeNull();
    fixture.nativeElement.querySelector('app-compact-row button').click(); fixture.detectChanges(); await fixture.whenStable();
    expect(selection).toHaveBeenCalledOnce();
    const profile = fixture.debugElement.query(By.directive(WorkoutProfileComponent)).componentInstance as WorkoutProfileComponent;
    expect(profile.structure()).toBe(fixture.componentInstance.structure);
    expect(profile.steps()[1].targetsText).toContain('min/km');
    fixture.componentRef.setInput('unitSettings', { distanceUnits: DistanceUnits.Miles, paceUnits: [PaceUnits.MinutesPerMile] });
    fixture.detectChanges(); await fixture.whenStable();
    expect(profile.steps()[1].targetsText).not.toContain('min/km');
    expect(profile.steps()[1].targetsText).toContain('min/m');
    expect(fixture.nativeElement.querySelector('app-compact-row button').getAttribute('aria-expanded')).toBe('true');
  });
  it('switches to a rest example without saving or retaining the workout review', async () => {
    const { fixture, selection } = await setup();
    fixture.componentInstance.toggleReview(); fixture.detectChanges();
    const rest = fixture.debugElement.queryAll(By.directive(MatButtonToggle)).find(toggle => toggle.componentInstance.value === 'rest')!;
    rest.nativeElement.querySelector('button').click(); fixture.detectChanges();
    expect(fixture.componentInstance.reviewExpanded()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Rest day suggested');
    fixture.componentInstance.toggleReview(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Mark as rest day');
    expect(fixture.debugElement.query(By.directive(WorkoutProfileComponent))).toBeNull();
    const count = selection.mock.calls.length;
    fixture.componentInstance.selectExample('rest');
    expect(selection).toHaveBeenCalledTimes(count);
  });
});
