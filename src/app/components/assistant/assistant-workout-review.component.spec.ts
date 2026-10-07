import { signal } from '@angular/core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivityTypes, AppThemes, DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { workoutReviewFixture } from '../../helpers/assistant-workout-review.test-support';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { WorkoutProfileComponent } from '../plans/workout-profile.component';
import { AssistantWorkoutReviewComponent } from './assistant-workout-review.component';

describe('AssistantWorkoutReviewComponent', () => {
  let haptics: { selection: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    haptics = { selection: vi.fn() };
    await TestBed.configureTestingModule({ imports: [AssistantWorkoutReviewComponent], providers: [
      { provide: AppHapticsService, useValue: haptics },
      { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
      { provide: EChartsLoaderService, useValue: { init: vi.fn(), dispose: vi.fn() } },
      { provide: LoggerService, useValue: { error: vi.fn() } },
    ] }).compileComponents();
  });
  it('renders exact before/after review and wires canonical graph highlights without hydration haptics', async () => {
    const value = workoutReviewFixture(); value.after!.structure.nodes[0].steps[1].ending = { kind: 'time', seconds: 75 };
    const fixture = TestBed.createComponent(AssistantWorkoutReviewComponent);
    fixture.componentRef.setInput('review', value); fixture.componentRef.setInput('contextKey', 'proposal:0');
    fixture.detectChanges(); await fixture.whenStable();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Duration / ending'); expect(text).toContain('Before'); expect(text).toContain('Proposed');
    expect(text).toContain('Wahoo: exact → unsupported'); expect(text).toContain('unknown duration');
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    const graph = fixture.debugElement.query(By.directive(WorkoutProfileComponent)).componentInstance as WorkoutProfileComponent;
    expect(graph.changedStepIds()).toEqual(['recovery']); expect(graph.structure()).toEqual(value.after!.structure);
    expect(graph.expanded()).toBe(false); expect(haptics.selection).not.toHaveBeenCalled();
    const button = fixture.nativeElement.querySelector('button'); button.click(); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false'); expect(haptics.selection).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector(`#${button.getAttribute('aria-controls')}`).hidden).toBe(true);
    graph.stepSelected.emit({ stepId: 'recovery', repeatId: 'block', iteration: 1, occurrenceKey: 'recovery:1' }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-review-step-id="recovery"]').classList.contains('selected')).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    const mapping = fixture.nativeElement.querySelector(`[aria-controls="${fixture.componentInstance.mappingRegionId}"]`);
    expect(mapping.getAttribute('aria-expanded')).toBe('false'); mapping.click(); fixture.detectChanges();
    expect(mapping.getAttribute('aria-expanded')).toBe('true'); expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
  it('keeps a full bounded change list available behind an accessible disclosure and resets on a new proposal', async () => {
    const value = workoutReviewFixture(); value.before = null; value.compatibility.forEach(provider => { provider.before = null; });
    value.after!.structure = { version: 1, sport: ActivityTypes.Running, nodes: Array.from({ length: 100 }, (_, index) => ({ kind: 'step', id: `step-${index}`,
      purpose: 'work', ending: { kind: 'time', seconds: 75 }, targets: [] })) };
    const fixture = TestBed.createComponent(AssistantWorkoutReviewComponent);
    fixture.componentRef.setInput('review', value); fixture.componentRef.setInput('contextKey', 'proposal:0');
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('button').textContent).toContain('100 changed definitions');
    expect(fixture.nativeElement.querySelectorAll('[data-review-step-id]')).toHaveLength(100);
    expect(fixture.componentInstance.changesExpanded()).toBe(false);
    fixture.nativeElement.querySelector('button').click(); fixture.detectChanges(); expect(fixture.componentInstance.changesExpanded()).toBe(true);
    writeSyntheticReviewFixture('assistant-review-large.html', fixture.nativeElement.outerHTML);
    fixture.componentRef.setInput('contextKey', 'fresh-proposal:0'); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.changesExpanded()).toBe(false); expect(haptics.selection).toHaveBeenCalledTimes(1);
  });
  it('keeps disclosures and selection open when owner unit settings refresh', async () => {
    const value = workoutReviewFixture(); value.after!.structure.nodes[0].steps[1].ending = { kind: 'time', seconds: 75 };
    value.after!.structure.nodes.push(...Array.from({ length: 8 }, (_, index) => ({ kind: 'step' as const, id: `added-${index}`,
      purpose: 'work' as const, ending: { kind: 'time' as const, seconds: 30 }, targets: [] })));
    const fixture = TestBed.createComponent(AssistantWorkoutReviewComponent);
    fixture.componentRef.setInput('review', value); fixture.componentRef.setInput('contextKey', 'proposal:0');
    fixture.detectChanges(); await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    fixture.nativeElement.querySelector(`[aria-controls="${fixture.componentInstance.mappingRegionId}"]`).click();
    const graph = fixture.debugElement.query(By.directive(WorkoutProfileComponent)).componentInstance as WorkoutProfileComponent;
    graph.stepSelected.emit({ stepId: 'recovery', repeatId: 'block', iteration: 1, occurrenceKey: 'recovery:1' });
    fixture.detectChanges();
    fixture.componentRef.setInput('unitSettings', { ...normalizeUserUnitSettings(), distanceUnits: DistanceUnits.Miles });
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.componentInstance.changesExpanded()).toBe(true);
    expect(fixture.componentInstance.mappingExpanded()).toBe(true);
    expect(fixture.componentInstance.selectedStepId()).toBe('recovery');
    expect(fixture.nativeElement.textContent).toContain('mi');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });
  it('renders exact pool settings when the formatted metadata rounds to the same value', async () => {
    const value = workoutReviewFixture();
    value.before!.structure.sport = ActivityTypes.Swimming;
    value.before!.structure.poolLength = { meters: 25.000000001, presentation: 'meters' };
    value.after = structuredClone(value.before); value.after!.structure.poolLength!.meters = 25.000000002;
    const fixture = TestBed.createComponent(AssistantWorkoutReviewComponent);
    fixture.componentRef.setInput('review', value); fixture.componentRef.setInput('contextKey', 'proposal:0');
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.precision-details').textContent).toContain('25.000000002');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('renders all 25 operation reviews and can export an isolated synthetic layout fixture', async () => {
    const html: string[] = [];
    for (let index = 0; index < 25; index++) {
      const value = workoutReviewFixture(); value.index = index;
      value.after!.structure.nodes[0].steps[1].ending = { kind: 'time', seconds: 75 };
      const fixture = TestBed.createComponent(AssistantWorkoutReviewComponent);
      fixture.componentRef.setInput('review', value); fixture.componentRef.setInput('contextKey', `proposal:${index}`);
      fixture.componentRef.setInput('compact', true);
      fixture.detectChanges(); await fixture.whenStable();
      expect(fixture.nativeElement.querySelectorAll('[data-review-step-id]')).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('.changes-list').hidden).toBe(true);
      html.push(fixture.nativeElement.outerHTML);
    }
    expect(haptics.selection).not.toHaveBeenCalled();
    writeSyntheticReviewFixture('assistant-review.html', html.join(''));
  });
});

function writeSyntheticReviewFixture(fileName: string, html: string): void {
  const directory = process.env.QS_ASSISTANT_REVIEW_FIXTURE_DIR;
  if (directory) {
    mkdirSync(directory, { recursive: true });
    const localStyles = readFileSync('src/app/components/assistant/assistant-workout-review.component.scss', 'utf8').replace(':host', '.fixture > div')
      + readFileSync('src/app/components/plans/workout-profile.component.scss', 'utf8').replace(':host', 'app-workout-profile');
    const styles = Array.from(document.querySelectorAll('style')).map(style => style.outerHTML).join('') + `<style>${localStyles}</style>`;
    writeFileSync(`${directory}/${fileName}`, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/styles.css">${styles}<style>body{margin:0}.fixture{max-width:980px;margin:auto;padding:16px;box-sizing:border-box}</style></head><body><main class="fixture"><h1>Review Training changes</h1>${html}<p>Nothing changes until you apply this proposal.</p><button class="mdc-button mat-mdc-button" type="button">Apply changes</button><button class="mdc-button mat-mdc-button" type="button">Dismiss</button></main></body></html>`);
  }
}
