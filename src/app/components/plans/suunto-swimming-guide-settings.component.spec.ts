import { signal } from '@angular/core';
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
    expect(fixture.componentInstance.canSave()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    fixture.componentInstance.toggle(); fixture.detectChanges();
    expect(element.querySelector('section')?.hidden).toBe(false);
    expect(element.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
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
