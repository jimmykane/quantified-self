import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import type { AiInsightsPromptSection } from './ai-insights.prompts';
import { MaterialModule } from '../../modules/material.module';

export interface AiInsightsPromptPickerDialogData {
  promptSections: readonly AiInsightsPromptSection[];
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
  readonly promptSections = this.data.promptSections;
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
  readonly filteredPromptSections = computed<readonly AiInsightsPromptSection[]>(() => {
    const normalizedSearchTerm = this.normalizedSearchTerm();
    if (!normalizedSearchTerm) {
      return this.promptSections;
    }

    return this.promptSections
      .map((section) => ({
        ...section,
        groups: section.groups
          .map((group) => ({
            ...group,
            prompts: group.prompts.filter(prompt => prompt.prompt.toLocaleLowerCase().includes(normalizedSearchTerm)),
          }))
          .filter((group) => group.prompts.length > 0),
      }))
      .filter((section) => section.groups.length > 0);
  });
  readonly hasFilteredPrompts = computed(() => this.filteredPromptSections().length > 0);

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
