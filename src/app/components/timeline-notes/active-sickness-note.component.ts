import { ChangeDetectionStrategy, Component, LOCALE_ID, NgZone, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import { activeSicknessNotes, currentSicknessNoteRange, sicknessNoteLabel } from '../../helpers/timeline-sickness-context.helper';

/** Owner-only context; note selection and its haptic feedback remain owned by the existing workspace. */
@Component({
  selector: 'app-active-sickness-note', standalone: true, imports: [MatButtonModule],
  templateUrl: './active-sickness-note.component.html', styleUrl: './active-sickness-note.component.scss',
  host: { '[style.display]': "hasActiveSickness() ? 'block' : 'none'" },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActiveSicknessNoteComponent {
  readonly context = input<TimelineNoteChartContext | null>(null);
  private readonly locale = inject(LOCALE_ID);
  private readonly zone = inject(NgZone);
  private readonly now = signal(Date.now());
  private readonly owner = computed(() => this.context()?.ownerUid ?? null);
  private readonly registration = computed(() => {
    const context = this.context();
    return context?.ownerUid ? { owner: context.ownerUid, report: context.reportRange, current: context.reportCurrentRange } : null;
  }, { equal: (a, b) => a?.owner === b?.owner && a?.report === b?.report && a?.current === b?.current });
  private readonly currentRange = () => currentSicknessNoteRange(Date.now());
  private readonly range = computed(() => currentSicknessNoteRange(this.now()), {
    equal: (a, b) => a.startDate === b.startDate && a.endDate === b.endDate,
  });
  readonly activeNotes = computed(() => {
    const context = this.context();
    return context?.ownerUid ? activeSicknessNotes(context.currentNotes ?? context.notes, this.now()) : [];
  }, { equal: (a, b) => a.length === b.length && a.every((note, index) => note === b[index]) });
  readonly hasActiveSickness = computed(() => this.activeNotes().length > 0);
  readonly label = computed(() => sicknessNoteLabel(this.activeNotes(), this.now(), this.locale));

  constructor() {
    effect(onCleanup => {
      const registration = this.registration();
      if (!registration) return;
      const range = this.range(); // Revalidate on a new UTC day, never on same-day minute ticks.
      if (registration.current) {
        registration.current(this, this.currentRange);
        onCleanup(() => registration.current!(this, null));
      } else {
        registration.report(this, range);
        onCleanup(() => registration.report(this, null));
      }
    });
    effect(onCleanup => {
      if (!this.owner() || typeof window === 'undefined') return;
      // Keep ended/single-day notes correct in an open tab, as well as on foreground return.
      let interval: number | undefined;
      const update = () => { if (document.visibilityState !== 'hidden') this.now.set(Date.now()); };
      const visibility = () => {
        window.clearInterval(interval);
        interval = undefined;
        if (document.visibilityState === 'hidden') return;
        update();
        interval = window.setInterval(update, 60_000);
      };
      // Passive wall-clock work must not hold Angular's stability/SSR boundary open.
      // Signals schedule their own rendering; no zone entry or manual change detection is needed.
      this.zone.runOutsideAngular(() => {
        visibility();
        window.addEventListener('focus', update);
        document.addEventListener('visibilitychange', visibility);
      });
      onCleanup(() => {
        window.clearInterval(interval);
        window.removeEventListener('focus', update);
        document.removeEventListener('visibilitychange', visibility);
      });
    });
  }

  open(): void {
    const context = this.context();
    if (!context?.ownerUid) return;
    const notes = activeSicknessNotes(context.currentNotes ?? context.notes, Date.now());
    if (notes.length) context.select(notes);
  }
}
