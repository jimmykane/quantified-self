import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { ASSISTANT_PROMPT_EXAMPLES } from '@shared/assistant.prompts';
import type { AssistantLocationAccess } from '@shared/assistant.types';
import { SharedModule } from '../../modules/shared.module';

export interface AssistantExploreBottomSheetData {
  locationAccess: AssistantLocationAccess;
}

export type AssistantExploreBottomSheetResult =
  | { kind: 'prompt'; prompt: string }
  | { kind: 'location_access'; locationAccess: AssistantLocationAccess };

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
    MatBottomSheetRef<
      AssistantExploreBottomSheetComponent,
      AssistantExploreBottomSheetResult
    >,
  );
  readonly data = inject<AssistantExploreBottomSheetData>(MAT_BOTTOM_SHEET_DATA);

  readonly prompts = ASSISTANT_PROMPT_EXAMPLES;

  selectPrompt(prompt: string): void {
    this.bottomSheetRef.dismiss({ kind: 'prompt', prompt });
  }

  setPreciseActivityLocations(enabled: boolean): void {
    this.bottomSheetRef.dismiss({
      kind: 'location_access',
      locationAccess: enabled ? 'precise_activity' : 'coordinate_free',
    });
  }

  close(): void {
    this.bottomSheetRef.dismiss();
  }
}
