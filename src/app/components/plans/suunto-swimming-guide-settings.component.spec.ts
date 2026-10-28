import { signal } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { WorkoutStepV1, WorkoutStructureV1 } from '@shared/planned-workout';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSuuntoSwimmingGuideSettings } from '@shared/suunto-swimming-guide-settings';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { SuuntoSwimmingGuideSettingsComponent } from './suunto-swimming-guide-settings.component';

describe('Suunto swimming screen preferences', () => {
  const user = signal({ uid: 'owner', settings: { suuntoSwimmingGuide: defaultSuuntoSwimmingGuideSettings() } });
  let save: ReturnType<typeof vi.fn>; let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    user.set({ uid: 'owner', settings: { suuntoSwimmingGuide: defaultSuuntoSwimmingGuideSettings() } });
    save = vi.fn().mockResolvedValue(undefined); haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    await TestBed.configureTestingModule({ imports: [SuuntoSwimmingGuideSettingsComponent], providers: [provideNoopAnimations(),
      { provide: AppUserService, useValue: { user, updateUserProperties: save } }, { provide: AppHapticsService, useValue: haptics }] }).compileComponents();
  });
  const render = () => { const fixture = TestBed.createComponent(SuuntoSwimmingGuideSettingsComponent); fixture.detectChanges(); return fixture; };
  it('initializes silently, keeps controls disclosed and explains previous-lap limitations', () => {
    const fixture = render(); const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('section')?.hidden).toBe(true);
    expect(element.textContent).toContain('planned, not measured');
    expect(element.textContent).toContain('only its final segment');
    expect(element.textContent).toContain('creates missing lap boundaries at automatic step endings');
    expect(element.textContent).toContain('Lap-button endings are not duplicated');
    expect(element.textContent).toContain('Another Lap recorded without ending Rest changes which lap is shown');
    expect(element.textContent).toContain('Pace and stroke readings depend on the watch and recorded swim data');
    expect(element.textContent).toContain('choose Duplicate to… in its sync details or workout actions');
    expect(element.textContent).not.toContain('Repeat on another date');
    expect(fixture.componentInstance.canSave()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    fixture.componentInstance.toggle(); fixture.detectChanges();
    expect(element.querySelector('section')?.hidden).toBe(false);
    expect(element.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  });
  it('binds each disclosure to its own region when plan and workout dialogs coexist', () => {
    const first = render(); const second = render();
    // TestBed's root renderer may detach the earlier fixture. Keep both real
    // component hosts attached, as overlapping Material dialogs would be.
    document.body.append(first.nativeElement, second.nativeElement);
    const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 100 }, targets: [] },
    ] };
    for (const fixture of [first, second]) {
      fixture.componentRef.setInput('structure', structure); fixture.detectChanges();
    }
    const ids = new Set<string>();
    for (const fixture of [first, second]) {
      const host = fixture.nativeElement as HTMLElement;
      for (const toggle of Array.from(host.querySelectorAll('button[aria-controls]'))) {
        const id = toggle.getAttribute('aria-controls')!;
        expect(ids.has(id)).toBe(false);
        ids.add(id);
        expect(host.querySelector(`[id="${id}"]`)).not.toBeNull();
        expect(document.getElementById(id)).toBe(host.querySelector(`[id="${id}"]`));
      }
    }
    expect(ids.size).toBe(4); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('explains planned Work distances and repetition counts without changing saved choices or Guide behavior', async () => {
    const fixture = render(); const component = fixture.componentInstance;
    const original = structuredClone(component.draft());
    component.toggle(); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const selectedLabels = Array.from(element.querySelectorAll('mat-select')).map(select => select.textContent?.trim());
    expect(selectedLabels).toContain('Last work block: planned distance');
    expect(selectedLabels).toContain('Next work block: planned distance');
    for (const phrase of ['Work blocks before/after this Rest', 'same value for both',
      'not measured distance', 'Lap-only Work has no prescribed distance',
      'regardless of titles/notes', 'Work 1/10 is the first of ten Work blocks',
      'Rest 1/10 follows it', "Suunto controls the heading's font size"]) {
      expect(element.textContent).toContain(phrase);
    }
    expect(element.textContent).not.toContain('Previous planned interval distance');
    expect(element.textContent).not.toContain('Next planned interval distance');
    expect(component.draft()).toEqual(original);
    expect(component.draft().restFields).toEqual(['interval', 'previousPlannedDistance', 'nextPlannedDistance', 'heartRate']);
    expect(component.canSave()).toBe(false); expect(save).not.toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('changes/reorders choices with one feedback owner, ignoring duplicates and no-ops', () => {
    const component = render().componentInstance;
    component.choose('workFields', 0, 'strokes'); component.move('workFields', 0, 1);
    expect(component.draft().workFields).toEqual(['duration', 'strokes', 'pace', 'interval']);
    component.choose('workFields', 1, 'pace'); component.move('workFields', 0, -1); component.choose('workFields', 0, 'duration');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(component.sections()[0].fields[1].choices.find(choice => choice.value === 'pace')!.disabled).toBe(true);
  });
  it('offers explicit previous-lap readings, not freshly reset Rest averages or guessed selectors', () => {
    const component = render().componentInstance;
    const rest = component.sections()[1];
    expect(rest.allowed).not.toContain('pace'); expect(rest.allowed).not.toContain('strokeRate');
    expect(rest.allowed).toContain('previousLapPace');
    expect(rest.allowed).toContain('previousLapDuration');
    expect(rest.allowed).toContain('previousLapStrokes');
    component.choose('restFields', 0, 'windowOffset');
    expect(component.changed()).toBe(false); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('saves previous-lap choices and previews only Rest immediately after Work with countdown first', async () => {
    const fixture = render(); const component = fixture.componentInstance;
    fixture.componentRef.setInput('structure', { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
      { kind: 'step', id: 'rest-again', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
    ] } satisfies WorkoutStructureV1);
    component.choose('restFields', 1, 'previousLapPace');
    component.choose('restFields', 2, 'previousLapDuration');
    component.choose('restFields', 3, 'previousLapStrokes');
    fixture.detectChanges();
    const rows = component.availability()!.rows;
    expect(fixture.nativeElement.textContent).toContain('large Guides may omit interval headings, planned distances and Last Work lap readings to fit the file-size limit');
    expect(rows[0].fields[0].type).toBe('stepDurationCountdown');
    expect(rows[0].choices.filter(choice => choice.state === 'included')).toHaveLength(3);
    expect(rows[1].choices.filter(choice => choice.field.startsWith('previousLap'))
      .every(choice => choice.state === 'omitted')).toBe(true);
    expect(rows[0].choices.find(choice => choice.field === 'previousLapPace')?.reason).toContain('final segment');
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    await component.save();
    expect(save).toHaveBeenCalledExactlyOnceWith(user(), { settings: { suuntoSwimmingGuide: component.draft() } });
    expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('blocks previous-lap early-Lap paths above the screen limit without blocking frozen default screens', () => {
    const fixture = render(); const component = fixture.componentInstance;
    const target: WorkoutStepV1['targets'] = [{ kind: 'speed', mode: 'absolute', presentation: 'speed',
      minimumMetersPerSecond: 1, maximumMetersPerSecond: 2 }];
    fixture.componentRef.setInput('structure', { version: 1, sport: ActivityTypes.Swimming,
      nodes: Array.from({ length: 4 }, (_, index) => ({ kind: 'repeat', id: `set-${index}`, count: 100, steps: [
        { kind: 'step', id: `work-${index}`, purpose: 'work', ending: { kind: 'distance', meters: 100, allowEarlyLap: true }, targets: target, note: 'Relax' },
        { kind: 'step', id: `rest-${index}`, purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: target, note: 'Relax' },
      ] })) } satisfies WorkoutStructureV1);
    fixture.detectChanges();
    expect(component.availability()?.blocked).toBe(false);
    component.choose('restFields', 1, 'previousLapPace'); fixture.detectChanges();
    expect(component.availability()).toMatchObject({ blocked: true, compact: false, rows: [] });
    component.reset(); fixture.detectChanges();
    expect(component.availability()?.blocked).toBe(false);
  });
  it('reports per-step target pressure, heading allocation and absent planned distances using the saved recipe', () => {
    const fixture = render(); const component = fixture.componentInstance;
    const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 100 },
        targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 150 }] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] }] };
    fixture.componentRef.setInput('structure', structure);
    component.add('workFields'); component.choose('workFields', 4, 'workoutDistance');
    component.toggle(); component.toggleAvailability(); fixture.detectChanges();
    const rows = component.availability()!.rows;
    expect(rows[0].title).toBe('Rest 1/1'); // REST first, chronological step retained.
    expect(rows[0].index).toBe(1);
    expect(rows[0].choices.find(choice => choice.field === 'nextPlannedDistance')).toMatchObject({ state: 'omitted' });
    expect(rows[1].choices.find(choice => choice.field === 'interval')).toMatchObject({ state: 'heading' });
    expect(rows[1].choices.find(choice => choice.field === 'workoutDistance')).toMatchObject({ state: 'omitted' });
    expect(fixture.nativeElement.textContent).toContain('No space after');
    expect(fixture.nativeElement.textContent).toContain('not guaranteed visible');
    fixture.componentRef.setInput('structure', null); fixture.detectChanges();
    expect(component.availability()).toBeNull();
    expect(fixture.nativeElement.querySelector(`[id="${component.availabilityRegionId}"]`)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it('shows omissions beside choices with the detailed report closed and updates after reordering', () => {
    const fixture = render(); const component = fixture.componentInstance;
    const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { kind: 'repeat', id: 'set', count: 10, steps: [
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 100 },
          targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 150 }] },
        { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 },
          targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 80, maximumBpm: 120 }] },
      ] },
    ] };
    fixture.componentRef.setInput('structure', structure);
    component.add('workFields'); component.choose('workFields', 4, 'workoutDistance');
    component.toggle(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const total = component.sections()[0].fields.find(row => row.field === 'workoutDistance')!;
    expect(total.allocation).toMatchObject({ omitted: true, summary: 'Omitted on 10 of 10 Work steps.' });
    expect(total.allocation?.reasons).toHaveLength(1);
    const description = element.querySelector(`[id="${total.descriptionId}"]`)!;
    expect(description.textContent).toContain('No space after');
    expect(description.closest('[hidden]')).toBeNull();
    expect(element.querySelector(`mat-select[aria-describedby="${total.descriptionId}"]`)).not.toBeNull();
    expect(component.availabilityExpanded()).toBe(false);
    expect(element.textContent).toContain('That leaves two for extras before instructions');
    component.move('workFields', 4, -1); component.move('workFields', 3, -1); component.move('workFields', 2, -1);
    fixture.detectChanges();
    expect(component.sections()[0].fields.find(row => row.field === 'workoutDistance')?.allocation)
      .toMatchObject({ omitted: false, summary: 'Included on all 10 Work steps.' });
    expect(component.sections()[0].fields.find(row => row.field === 'pace')?.allocation?.omitted).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
  it('distinguishes mixed target steps and missing planned context without duplicating repeated reasons', () => {
    const fixture = render(); const component = fixture.componentInstance;
    fixture.componentRef.setInput('structure', { version: 1, sport: ActivityTypes.OpenWaterSwimming, nodes: [
      { kind: 'step', id: 'targeted', purpose: 'work', ending: { kind: 'distance', meters: 100 },
        targets: [{ kind: 'heart-rate', mode: 'absolute', minimumBpm: 120, maximumBpm: 150 }] },
      { kind: 'step', id: 'untargeted', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
    ] } satisfies WorkoutStructureV1);
    component.add('workFields'); component.choose('workFields', 4, 'workoutDistance'); fixture.detectChanges();
    expect(component.sections()[0].fields.find(row => row.field === 'workoutDistance')?.allocation)
      .toMatchObject({ summary: 'Omitted on 1 of 2 Work steps.' });
    expect(component.sections()[0].fields.find(row => row.field === 'interval')?.allocation?.summary)
      .toBe('In the heading on all 2 Work steps.');
    expect(component.sections()[1].fields.find(row => row.field === 'previousPlannedDistance')?.allocation)
      .toEqual({ omitted: true, summary: 'Omitted on 1 of 1 Rest step.',
        reasons: ['The adjacent Work step has no prescribed distance.'] });
    fixture.componentRef.setInput('structure', null); fixture.detectChanges();
    expect(component.sections().flatMap(section => section.fields).every(row => row.allocation === null)).toBe(true);
  });
  it('bounds availability rendering and silently resets paging when the recipe changes', () => {
    const fixture = render(); const component = fixture.componentInstance;
    const structure: WorkoutStructureV1 = { version: 1, sport: ActivityTypes.OpenWaterSwimming, nodes: [
      { kind: 'repeat', id: 'sets', count: 10, steps: [
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'distance', meters: 100 }, targets: [] },
        { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] }] }] };
    fixture.componentRef.setInput('structure', structure); component.toggleAvailability(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.availability-step')).toHaveLength(6);
    expect(component.visibleAvailabilityRows().map(row => row.title)).toEqual([
      'Rest 1/10', 'Rest 2/10', 'Rest 3/10', 'Work 1/10', 'Work 2/10', 'Work 3/10',
    ]);
    component.showMoreAvailability(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.availability-step')).toHaveLength(12);
    const count = haptics.selection.mock.calls.length;
    fixture.componentRef.setInput('structure', { ...structure }); fixture.detectChanges();
    expect(component.availabilityLimit()).toBe(6); expect(haptics.selection).toHaveBeenCalledTimes(count);
  });
  it('does not claim included fields for an unsupported swim prescription', () => {
    const fixture = render(); const component = fixture.componentInstance;
    fixture.componentRef.setInput('structure', { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'repetitions', repetitions: 10 }, targets: [] },
    ] } satisfies WorkoutStructureV1);
    component.toggleAvailability(); fixture.detectChanges();
    expect(component.availability()).toMatchObject({ blocked: true, rows: [] });
    expect(component.sections().flatMap(section => section.fields).every(row => row.allocation === null)).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('cannot currently be sent as a Suunto Guide');
    expect(save).not.toHaveBeenCalled();
  });
  it('bounds choices at five and restores defaults without sending or changing a recipe', () => {
    const component = render().componentInstance;
    for (let i = 0; i < 10; i++) component.add('workFields');
    expect(component.draft().workFields).toHaveLength(5);
    component.remove('workFields', 1); component.reset();
    expect(component.draft()).toEqual(defaultSuuntoSwimmingGuideSettings());
    expect(save).not.toHaveBeenCalled();
  });
  it('saves only owner display settings through the existing settings path', async () => {
    const component = render().componentInstance;
    component.choose('workFields', 0, 'strokes'); await component.save();
    expect(save).toHaveBeenCalledExactlyOnceWith(user(), { settings: { suuntoSwimmingGuide: component.draft() } });
    expect(component.notice()).toContain('already opted into sync');
    expect(haptics.success).toHaveBeenCalledOnce(); expect(component.canSave()).toBe(false);
  });
  it('clears stale save feedback only after accepted draft edits, without another write', async () => {
    const component = render().componentInstance;
    component.choose('workFields', 0, 'strokes'); await component.save();
    const success = component.notice();
    component.choose('workFields', 0, 'strokes');
    expect(component.notice()).toBe(success); // An unchanged selection is silent.
    component.choose('workFields', 0, 'heartRate');
    expect(component.notice()).toBeNull(); expect(component.canSave()).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    component.error.set('Previous save failed'); component.move('workFields', 0, 1);
    expect(component.error()).toBeNull(); expect(save).toHaveBeenCalledOnce();
  });
  it('preserves choices on failed save and reports success only after a successful retry', async () => {
    save.mockRejectedValueOnce(new Error('fixture'));
    const component = render().componentInstance;
    component.choose('restFields', 1, 'workoutStrokes'); const draft = component.draft();
    await component.save(); expect(component.draft()).toEqual(draft); expect(component.error()).toContain('choices are kept');
    expect(haptics.error).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled();
    await component.save(); expect(haptics.success).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledTimes(2);
  });
  it('does not revert a successful save when an unrelated profile update still carries old preferences', async () => {
    const fixture = render(); const component = fixture.componentInstance;
    component.choose('workFields', 0, 'strokes'); await component.save();
    const saved = component.draft();
    user.set({ ...user(), settings: { ...user().settings } }); fixture.detectChanges();
    expect(component.draft()).toEqual(saved); expect(component.changed()).toBe(false);
    user.set({ ...user(), settings: { suuntoSwimmingGuide: saved } }); fixture.detectChanges();
    expect(component.draft()).toEqual(saved); expect(haptics.selection).toHaveBeenCalledOnce();
  });
  it('does not save again or publish success to a replacement account after an in-flight write', async () => {
    let finish!: () => void; save.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const fixture = render(); const component = fixture.componentInstance;
    component.choose('workFields', 0, 'strokes'); const pending = component.save();
    user.set({ uid: 'other', settings: { suuntoSwimmingGuide: defaultSuuntoSwimmingGuideSettings() } }); fixture.detectChanges();
    finish(); await pending; await component.save();
    expect(save).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled(); expect(component.notice()).toBeNull();
  });
});
