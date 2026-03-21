import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import type { AiInsightsPromptGroup } from './ai-insights.prompts';
import { MaterialModule } from '../../modules/material.module';

export interface AiInsightsPromptPickerDialogData {
  promptGroups: readonly AiInsightsPromptGroup[];
  promptSource: 'default' | 'unsupported';
}

@Component({
  selector: 'app-ai-insights-prompt-picker-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatFormFieldModule,
    MaterialModule,
  ],
  templateUrl: './ai-insights-prompt-picker-dialog.component.html',
  styleUrls: ['./ai-insights-prompt-picker-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsPromptPickerDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AiInsightsPromptPickerDialogComponent, string | undefined>);
  readonly data = inject<AiInsightsPromptPickerDialogData>(MAT_DIALOG_DATA);
  readonly promptGroups = this.data.promptGroups;
  readonly searchTerm = signal('');
  readonly dialogTitle = computed(() => (
    this.data.promptSource === 'unsupported'
      ? 'Try a supported prompt'
      : 'Prompt ideas'
  ));
  readonly dialogCopy = computed(() => (
    this.data.promptSource === 'unsupported'
      ? 'This request is not supported yet. Pick one of these examples.'
      : 'Select a prompt to run it immediately.'
  ));
  readonly normalizedSearchTerm = computed(() => this.searchTerm().trim().toLocaleLowerCase());
  readonly filteredPromptGroups = computed<readonly AiInsightsPromptGroup[]>(() => {
    const normalizedSearchTerm = this.normalizedSearchTerm();
    if (!normalizedSearchTerm) {
      return this.promptGroups;
    }

    return this.promptGroups
      .map((group) => ({
        ...group,
        prompts: group.prompts.filter(prompt => prompt.prompt.toLocaleLowerCase().includes(normalizedSearchTerm)),
      }))
      .filter(group => group.prompts.length > 0);
  });
  readonly hasFilteredPrompts = computed(() => this.filteredPromptGroups().length > 0);

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.searchTerm.set(target?.value ?? '');
  }

  clearSearch(): void {
    this.searchTerm.set('');
  }

  selectPrompt(prompt: string): void {
    this.dialogRef.close(prompt);
  }

  close(): void {
    this.dialogRef.close();
  }
}
