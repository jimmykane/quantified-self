import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { MCP_STARTER_QUESTIONS, QUICK_QUESTION_IDS, type McpStarterQuestionId } from './mcp-starter-questions';

const CONNECTION_QUESTION_GROUPS = [
  QUICK_QUESTION_IDS,
  (Object.keys(MCP_STARTER_QUESTIONS) as McpStarterQuestionId[]).filter(id => !QUICK_QUESTION_IDS.some(quick => quick === id)),
];

@Component({
  selector: 'app-mcp-starter-prompts',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (group of questionGroups(); track $index; let first = $first) {
      @if (!first) {
        <button mat-button type="button" [attr.aria-expanded]="expanded()" aria-controls="more-mcp-questions" (click)="toggleMore()">
          <mat-icon>{{ expanded() ? 'expand_less' : 'expand_more' }}</mat-icon>{{ expanded() ? 'Show fewer questions' : 'Show more questions' }}
        </button>
      }
      <div [attr.id]="first ? null : 'more-mcp-questions'" [hidden]="!first && !expanded()">
        @if (first || expanded()) {
          @for (id of group; track id) {
            <div class="prompt">
              <div>
                @if (!question()) { <h4>{{ questions[id].title }}</h4> }
                <p>{{ questions[id].text }}</p>
              </div>
              <button type="button" mat-stroked-button (click)="copy(id)" [attr.aria-label]="'Copy question: ' + questions[id].title">
                <mat-icon>content_copy</mat-icon>Copy question
              </button>
            </div>
          }
        }
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
    :host(.example-question) .prompt { flex-direction: column; align-items: flex-start; gap: .75rem; padding: 0; }
    @media (max-width: 640px) { .prompt { align-items: flex-start; flex-direction: column; gap: .65rem; } }
  `,
})
export class McpStarterPromptsComponent {
  readonly question = input<McpStarterQuestionId>();
  protected readonly questions = MCP_STARTER_QUESTIONS;
  protected readonly questionGroups = computed(() => {
    const id = this.question();
    return id ? [[id]] : CONNECTION_QUESTION_GROUPS;
  });
  protected readonly expanded = signal(false);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly haptics = inject(AppHapticsService);
  private readonly analytics = inject(AppAnalyticsService);

  protected toggleMore(): void {
    this.expanded.update(value => !value);
    this.haptics.selection();
  }

  protected copy(id: McpStarterQuestionId): void {
    if (!this.clipboard.copy(this.questions[id].text)) {
      this.haptics.error();
      this.snackBar.open('Select the question text and copy it manually.', undefined, { duration: 5000 });
      return;
    }
    this.haptics.success();
    this.snackBar.open('Question copied.', undefined, { duration: 3000 });
    this.analytics.logMcpGuideAction('mcp_question_copied', id);
  }
}
