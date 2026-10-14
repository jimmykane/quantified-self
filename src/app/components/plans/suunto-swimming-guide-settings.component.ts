import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { SharedModule } from '../../modules/shared.module';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { defaultSuuntoSwimmingGuideSettings, normalizeSuuntoSwimmingGuideSettings, parseSuuntoSwimmingGuideSettings,
  SUUNTO_SWIM_WORK_FIELDS, SUUNTO_SWIM_REST_FIELDS, SUUNTO_SWIM_FIELD_LABELS } from '@shared/suunto-swimming-guide-settings';
type Phase = 'workFields' | 'restFields';
@Component({ selector: 'app-suunto-swimming-guide-settings', standalone: true, imports: [SharedModule],
  templateUrl: './suunto-swimming-guide-settings.component.html', styleUrl: './suunto-swimming-guide-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class SuuntoSwimmingGuideSettingsComponent {
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  readonly expanded = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly draft = signal(defaultSuuntoSwimmingGuideSettings());
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
  constructor() {
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
  choose(phase: Phase, index: number, value: string): void {
    if (this.saving() || this.draft()[phase][index] === value || index < 0 || index >= this.draft()[phase].length) return;
    const fields: string[] = [...this.draft()[phase]]; fields[index] = value;
    try { this.draft.set(parseSuuntoSwimmingGuideSettings({ ...this.draft(), [phase]: fields })); this.haptics.selection(); }
    catch { /* Invalid/duplicate selections never become preferences. */ }
  }
  move(phase: Phase, index: number, delta: number): void {
    const fields = [...this.draft()[phase]]; const to = index + delta;
    if (this.saving() || index < 0 || index >= fields.length || to < 0 || to >= fields.length || to === index) return;
    [fields[index], fields[to]] = [fields[to], fields[index]];
    this.draft.set(parseSuuntoSwimmingGuideSettings({ ...this.draft(), [phase]: fields })); this.haptics.selection();
  }
  remove(phase: Phase, index: number): void {
    if (this.saving() || index < 0 || index >= this.draft()[phase].length) return;
    this.draft.set(parseSuuntoSwimmingGuideSettings({ ...this.draft(), [phase]: this.draft()[phase].filter((_, i) => i !== index) })); this.haptics.selection();
  }
  add(phase: Phase): void {
    if (this.saving() || this.draft()[phase].length >= 5) return;
    const allowed = phase === 'workFields' ? SUUNTO_SWIM_WORK_FIELDS : SUUNTO_SWIM_REST_FIELDS;
    const field = allowed.find(value => !this.draft()[phase].some(selected => selected === value));
    if (!field) return;
    this.draft.set(parseSuuntoSwimmingGuideSettings({ ...this.draft(), [phase]: [...this.draft()[phase], field] })); this.haptics.selection();
  }
  reset(): void {
    if (this.saving() || JSON.stringify(this.draft()) === JSON.stringify(defaultSuuntoSwimmingGuideSettings())) return;
    this.draft.set(defaultSuuntoSwimmingGuideSettings()); this.haptics.selection();
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
