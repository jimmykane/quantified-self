import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { parseWorkoutStructureV1, type WorkoutStructureV1 } from '@shared/planned-workout';
import { assessPlannedWorkoutProviderMappingV1 } from '@shared/planned-workout-providers';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { planSuuntoSwimmingScreen, suuntoSwimmingOccurrences, suuntoSwimmingRequiredShapes } from '@shared/suunto-swimming-screen';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { defaultSuuntoSwimmingGuideSettings, normalizeSuuntoSwimmingGuideSettings, parseSuuntoSwimmingGuideSettings,
  SUUNTO_SWIM_WORK_FIELDS, SUUNTO_SWIM_REST_FIELDS, SUUNTO_SWIM_FIELD_LABELS } from '@shared/suunto-swimming-guide-settings';
type Phase = 'workFields' | 'restFields';
let nextSwimmingGuideSettingsId = 0;
@Component({ selector: 'app-suunto-swimming-guide-settings', standalone: true, imports: [SharedModule],
  templateUrl: './suunto-swimming-guide-settings.component.html', styleUrl: './suunto-swimming-guide-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class SuuntoSwimmingGuideSettingsComponent {
  readonly fieldsRegionId = `suunto-swimming-guide-fields-${++nextSwimmingGuideSettingsId}`;
  readonly availabilityRegionId = `${this.fieldsRegionId}-availability`;
  readonly structure = input<WorkoutStructureV1 | null>(null);
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  readonly expanded = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly draft = signal(defaultSuuntoSwimmingGuideSettings());
  readonly availabilityExpanded = signal(false);
  readonly availabilityLimit = signal(6);
  private readonly owner = signal('');
  private readonly baseline = signal(JSON.stringify(defaultSuuntoSwimmingGuideSettings()));
  private observedPreferences = '';
  readonly changed = computed(() => JSON.stringify(this.draft()) !== this.baseline());
  readonly sections = computed(() => ([{ key: 'workFields' as const, label: 'Work', allowed: SUUNTO_SWIM_WORK_FIELDS },
    { key: 'restFields' as const, label: 'Rest', allowed: SUUNTO_SWIM_REST_FIELDS }]).map(section => ({ ...section,
      fields: this.draft()[section.key].map((field, index) => ({ field, index, label: SUUNTO_SWIM_FIELD_LABELS[field],
        choices: section.allowed.map(value => ({ value, label: SUUNTO_SWIM_FIELD_LABELS[value],
          disabled: value !== field && this.draft()[section.key].some(selected => selected === value) })) })) })));
  readonly canSave = computed(() => !this.saving() && this.changed() && !!this.owner() && this.users.user()?.uid === this.owner());
  readonly availability = computed(() => {
    const value = this.structure();
    if (!value || ![ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming].includes(value.sport)) return null;
    try {
      const structure = parseWorkoutStructureV1(value);
      if (assessPlannedWorkoutProviderMappingV1('suunto', structure).level === 'unsupported') {
        return { compact: false, blocked: true, rows: [] };
      }
      const occurrences = suuntoSwimmingOccurrences(structure);
      if (!occurrences) return { compact: true, blocked: false, rows: [] };
      const units = normalizeUserUnitSettings(this.users.user()?.settings?.unitSettings);
      const rows = occurrences.flatMap((occurrence, index) => {
        if (!['work', 'rest'].includes(occurrence.step.purpose)) return [];
        const result = planSuuntoSwimmingScreen(occurrence.step.purpose === 'rest' ? 'Rest' : 'Work',
          suuntoSwimmingRequiredShapes(occurrence.step), structure.sport, this.draft(), occurrence,
          occurrences[index - 1], occurrences[index + 1], units);
        return [{ ...result, index, rest: occurrence.step.purpose === 'rest',
          requiredCount: result.fields.length, choices: result.choices.map(choice => ({ ...choice,
            label: SUUNTO_SWIM_FIELD_LABELS[choice.field],
            status: choice.state === 'heading' ? 'Heading' : choice.state === 'included' ? 'Included' : 'Omitted' })) }];
      }).sort((left, right) => Number(right.rest) - Number(left.rest) || left.index - right.index);
      return { compact: false, blocked: false, rows };
    } catch { return null; }
  });
  readonly visibleAvailabilityRows = computed(() => {
    const rows = this.availability()?.rows ?? [];
    const rests = rows.filter(row => row.rest); const work = rows.filter(row => !row.rest);
    const limit = this.availabilityLimit();
    // REST first without burying Work behind every repeated Rest occurrence.
    const restCount = Math.min(rests.length, Math.max(Math.ceil(limit / 2), limit - work.length));
    return [...rests.slice(0, restCount), ...work.slice(0, limit - restCount)];
  });
  constructor() {
    effect(() => { this.structure(); untracked(() => this.availabilityLimit.set(6)); });
    effect(() => {
      const user = this.users.user(); const settings = normalizeSuuntoSwimmingGuideSettings(user?.settings?.suuntoSwimmingGuide);
      untracked(() => {
        const observed = JSON.stringify([user?.uid ?? '', settings]);
        if (observed === this.observedPreferences) return;
        this.observedPreferences = observed;
        if (user?.uid !== this.owner() || !this.changed()) {
          this.owner.set(user?.uid ?? ''); this.draft.set(settings); this.baseline.set(JSON.stringify(settings));
          this.error.set(null); this.notice.set(null);
        }
      });
    });
  }
  toggle(): void { this.expanded.update(value => !value); this.haptics.selection(); }
  toggleAvailability(): void { this.availabilityExpanded.update(value => !value); this.haptics.selection(); }
  showMoreAvailability(): void {
    if (this.availabilityLimit() >= (this.availability()?.rows.length ?? 0)) return;
    this.availabilityLimit.update(value => value + 6); this.haptics.selection();
  }
  choose(phase: Phase, index: number, value: string): void {
    if (this.saving() || this.draft()[phase][index] === value || index < 0 || index >= this.draft()[phase].length) return;
    const fields: string[] = [...this.draft()[phase]]; fields[index] = value;
    try { this.changeDraft({ ...this.draft(), [phase]: fields }); }
    catch { /* Invalid/duplicate selections never become preferences. */ }
  }
  move(phase: Phase, index: number, delta: number): void {
    const fields = [...this.draft()[phase]]; const to = index + delta;
    if (this.saving() || index < 0 || index >= fields.length || to < 0 || to >= fields.length || to === index) return;
    [fields[index], fields[to]] = [fields[to], fields[index]];
    this.changeDraft({ ...this.draft(), [phase]: fields });
  }
  remove(phase: Phase, index: number): void {
    if (this.saving() || index < 0 || index >= this.draft()[phase].length) return;
    this.changeDraft({ ...this.draft(), [phase]: this.draft()[phase].filter((_, i) => i !== index) });
  }
  add(phase: Phase): void {
    if (this.saving() || this.draft()[phase].length >= 5) return;
    const allowed = phase === 'workFields' ? SUUNTO_SWIM_WORK_FIELDS : SUUNTO_SWIM_REST_FIELDS;
    const field = allowed.find(value => !this.draft()[phase].some(selected => selected === value));
    if (!field) return;
    this.changeDraft({ ...this.draft(), [phase]: [...this.draft()[phase], field] });
  }
  reset(): void {
    if (this.saving() || JSON.stringify(this.draft()) === JSON.stringify(defaultSuuntoSwimmingGuideSettings())) return;
    this.changeDraft(defaultSuuntoSwimmingGuideSettings());
  }
  private changeDraft(value: unknown): void {
    this.draft.set(parseSuuntoSwimmingGuideSettings(value));
    this.notice.set(null); this.error.set(null); this.haptics.selection();
  }
  async save(): Promise<void> {
    const user = this.users.user(); if (!this.canSave() || !user || user.uid !== this.owner()) return;
    const settings = parseSuuntoSwimmingGuideSettings(this.draft()); const uid = user.uid;
    this.saving.set(true); this.error.set(null); this.notice.set(null);
    try {
      await this.users.updateUserProperties(user, { settings: { suuntoSwimmingGuide: settings } });
      if (this.users.user()?.uid !== uid) return;
      this.baseline.set(JSON.stringify(settings));
      this.notice.set('Saved. Eligible swimming Guides already opted into sync update on the next automatic check. Past and completed copies stay unchanged.');
      this.haptics.success();
    } catch {
      if (this.users.user()?.uid !== uid) return;
      this.error.set('Could not save Guide screens. Your choices are kept; try again.'); this.haptics.error();
    } finally { this.saving.set(false); }
  }
}
