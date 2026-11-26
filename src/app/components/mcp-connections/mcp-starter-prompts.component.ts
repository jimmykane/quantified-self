import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';

const PROMPTS = [
  { id: 'training', title: 'Compare my training', text: 'Compare my last four weeks of training with the previous twelve. Show sessions and hours per four weeks for each sport I recorded. Where did my training change most?' },
  { id: 'race', title: 'Debrief a race', text: 'Help me debrief a race. Ask which race I mean, then use its recorded splits, heart rate, and power where available. Where did my effort change?' },
  { id: 'laps', title: 'Compare laps or climbs', text: 'Help me choose a workout with recorded laps or repeated climbs. Compare their duration and available heart rate or power, and explain which efforts are comparable.' },
] as const;
const GUIDE_PROMPT = [{ id: 'cycling', title: 'Compare my rides', text: 'Compare my last four weeks of cycling with the previous twelve. Show rides and hours per four weeks, average minutes per ride, and which recording devices you can identify. If the device is unknown, say so.' }] as const;

@Component({
  selector: 'app-mcp-starter-prompts',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (prompt of (guide() ? guidePrompts : connectionPrompts); track prompt.id) {
      <div class="prompt">
        <div>
          @if (!guide()) { <h4>{{ prompt.title }}</h4> }
          <p>{{ prompt.text }}</p>
        </div>
        <button type="button" mat-stroked-button (click)="copy(prompt)" [attr.aria-label]="'Copy question: ' + prompt.title">
          <mat-icon>content_copy</mat-icon>Copy question
        </button>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .prompt { display: flex; align-items: center; justify-content: space-between; gap: 1.25rem; padding-block: 1rem; }
    .prompt + .prompt { border-top: 1px solid var(--mat-sys-outline-variant); }
    h4 { margin: 0 0 .35rem; font: var(--mat-sys-title-medium); }
    p { margin: 0; line-height: 1.55; max-width: 64ch; }
    button { flex-shrink: 0; }
    @media (max-width: 640px) { .prompt { align-items: flex-start; flex-direction: column; gap: .65rem; } }
  `,
})
export class McpStarterPromptsComponent {
  readonly guide = input(false);
  protected readonly connectionPrompts = PROMPTS;
  protected readonly guidePrompts = GUIDE_PROMPT;
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly haptics = inject(AppHapticsService);
  private readonly analytics = inject(AppAnalyticsService);

  protected copy(prompt: (typeof PROMPTS | typeof GUIDE_PROMPT)[number]): void {
    if (!this.clipboard.copy(prompt.text)) {
      this.haptics.error();
      this.snackBar.open('Select the question text and copy it manually.', undefined, { duration: 5000 });
      return;
    }
    this.haptics.success();
    this.snackBar.open('Question copied.', undefined, { duration: 3000 });
    this.analytics.logMcpGuideAction('mcp_question_copied', prompt.id);
  }
}
