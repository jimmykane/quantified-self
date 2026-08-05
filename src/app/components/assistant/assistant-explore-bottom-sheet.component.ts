import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { ASSISTANT_PROMPT_EXAMPLES } from '@shared/assistant.prompts';
import { SharedModule } from '../../modules/shared.module';

@Component({
  selector: 'app-assistant-explore-bottom-sheet',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './assistant-explore-bottom-sheet.component.html',
  styleUrls: ['./assistant-explore-bottom-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantExploreBottomSheetComponent {
  private readonly bottomSheetRef = inject(
    MatBottomSheetRef<AssistantExploreBottomSheetComponent>,
  );

  readonly prompts = ASSISTANT_PROMPT_EXAMPLES;

  selectPrompt(prompt: string): void {
    this.bottomSheetRef.dismiss(prompt);
  }

  close(): void {
    this.bottomSheetRef.dismiss();
  }
}
