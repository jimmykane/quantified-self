import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
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
  readonly dialogTitle = computed(() => (
    this.data.promptSource === 'unsupported'
      ? 'Try one of these prompts'
      : 'Browse prompt ideas'
  ));
  readonly dialogCopy = computed(() => (
    this.data.promptSource === 'unsupported'
      ? 'This request is not supported yet. Pick one of these supported prompt examples instead.'
      : 'Choose a supported prompt example and run it as-is or adapt it in the input field.'
  ));

  selectPrompt(prompt: string): void {
    this.dialogRef.close(prompt);
  }

  close(): void {
    this.dialogRef.close();
  }
}
