import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { ASSISTANT_PROMPT_EXAMPLES } from '@shared/assistant.prompts';
import type { AssistantLocationAccess } from '@shared/assistant.types';
import { SharedModule } from '../../modules/shared.module';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';

export interface AssistantExploreBottomSheetData {
  timelineNotesEnabled?: boolean;
  activityTagChangesEnabled?: boolean;
  timelineNoteChangesEnabled?: boolean;
  trainingPlansEnabled?: boolean;
  trainingPlanChangesEnabled?: boolean;
  trainingDeliveryEnabled?: boolean;
  locationAccess: AssistantLocationAccess;
}

export type AssistantExploreBottomSheetResult =
  | { kind: 'training_plans'; enabled: boolean }
  | { kind: 'training_plan_changes'; enabled: boolean }
  | { kind: 'training_delivery'; enabled: boolean }
  | { kind: 'timeline_notes'; enabled: boolean }
  | { kind: 'activity_tag_changes'; enabled: boolean }
  | { kind: 'timeline_note_changes'; enabled: boolean }
  | { kind: 'prompt'; prompt: string }
  | { kind: 'location_access'; locationAccess: AssistantLocationAccess };

@Component({
  selector: 'app-assistant-explore-bottom-sheet',
  standalone: true,
  imports: [SharedModule, CompactRowComponent],
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

  setTimelineNotes(enabled: boolean): void {
    if (enabled === (this.data.timelineNotesEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'timeline_notes', enabled });
  }

  setActivityTagChanges(enabled: boolean): void {
    if (enabled === (this.data.activityTagChangesEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'activity_tag_changes', enabled });
  }

  setTimelineNoteChanges(enabled: boolean): void {
    if (enabled === (this.data.timelineNoteChangesEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'timeline_note_changes', enabled });
  }

  setTrainingPlans(enabled: boolean): void {
    if (enabled === (this.data.trainingPlansEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'training_plans', enabled });
  }

  setTrainingPlanChanges(enabled: boolean): void {
    if (enabled === (this.data.trainingPlanChangesEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'training_plan_changes', enabled });
  }

  setTrainingDelivery(enabled: boolean): void {
    if (enabled === (this.data.trainingDeliveryEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'training_delivery', enabled });
  }

  close(): void {
    this.bottomSheetRef.dismiss();
  }
}
