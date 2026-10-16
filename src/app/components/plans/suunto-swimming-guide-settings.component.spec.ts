import { signal } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { WorkoutStructureV1 } from '@shared/planned-workout';
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
  it('initializes silently, keeps controls disclosed and explains unsupported last-interval readings', () => {
    const fixture = render(); const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('section')?.hidden).toBe(true);
    expect(element.textContent).toContain('planned, not measured');
    expect(element.textContent).toContain('cannot select the completed interval');
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
  it('changes/reorders choices with one feedback owner, ignoring duplicates and no-ops', () => {
    const component = render().componentInstance;
    component.choose('workFields', 0, 'strokes'); component.move('workFields', 0, 1);
    expect(component.draft().workFields).toEqual(['duration', 'strokes', 'pace', 'interval']);
    component.choose('workFields', 1, 'pace'); component.move('workFields', 0, -1); component.choose('workFields', 0, 'duration');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(component.sections()[0].fields[1].choices.find(choice => choice.value === 'pace')!.disabled).toBe(true);
  });
  it('never offers Rest lap averages or pool detection/format hacks as functioning controls', () => {
    const component = render().componentInstance;
    const rest = component.sections()[1];
    expect(rest.allowed).not.toContain('pace'); expect(rest.allowed).not.toContain('strokeRate');
    component.choose('restFields', 0, 'previousLapPace');
    expect(component.changed()).toBe(false); expect(haptics.selection).not.toHaveBeenCalled();
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
