import { AppFunctionsService } from '../../services/app.functions.service';
import { ChangeDetectionStrategy, Component, inject, Injector, signal } from '@angular/core';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { ASSISTANT_PROMPT_CARDS } from '@shared/assistant.prompts';
import type { AssistantLocationAccess } from '@shared/assistant.types';
import { SharedModule } from '../../modules/shared.module';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { AppHapticsService } from '../../services/app.haptics.service';

export interface AssistantExploreBottomSheetData {
  conversationId?: string | null;
  timelineNotesEnabled?: boolean;
  activityTagChangesEnabled?: boolean;
  timelineNoteChangesEnabled?: boolean;
  measurementChangesEnabled?: boolean;
  reflectionChangesEnabled?: boolean;
  trainingThresholdsEnabled?: boolean;
  trainingPlansEnabled?: boolean;
  trainingPlanChangesEnabled?: boolean;
  trainingDeliveryEnabled?: boolean;
  locationAccess: AssistantLocationAccess;
}

export type AssistantExploreBottomSheetResult =
  | { kind: 'reflection_changes'; enabled: boolean }
  | { kind: 'training_thresholds'; enabled: boolean }
  | { kind: 'measurement_changes'; enabled: boolean }
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
  private readonly haptics = inject(AppHapticsService);
  private readonly bottomSheetRef = inject(
    MatBottomSheetRef<
      AssistantExploreBottomSheetComponent,
      AssistantExploreBottomSheetResult
    >,
  );
  readonly data = inject<AssistantExploreBottomSheetData>(MAT_BOTTOM_SHEET_DATA);

  private readonly injector = inject(Injector);
  readonly privateEnabled = signal(false);
  readonly privateLoading = signal(false);
  readonly privateError = signal('');
  constructor() {
    if (this.data.trainingPlansEnabled && this.data.conversationId) void this.privateAccess();
  }
  async privateAccess(enabled?: boolean) {
    if (this.privateLoading() || !this.data.conversationId) return;
    this.privateLoading.set(true);
    this.privateError.set('');
    try {
      const response = await this.injector.get(AppFunctionsService).call<object,{ enabled: boolean }>('trainingPlanTemplates', {
        action: 'assistant-access', conversationId: this.data.conversationId, ...(enabled === undefined ? {} : { enabled }) });
      this.privateEnabled.set(response.data.enabled);
      if (enabled !== undefined) this.haptics.selection();
    } catch { this.privateError.set('Private template permission could not be loaded or changed.'); }
    finally { this.privateLoading.set(false); }
  }
  readonly prompts = ASSISTANT_PROMPT_CARDS;

  selectPrompt(prompt: string): void {
    this.haptics.selection();
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

  setReflectionChanges(enabled: boolean): void {
    if (enabled === (this.data.reflectionChangesEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'reflection_changes', enabled });
  }

  setTrainingThresholds(enabled: boolean): void {
    if (enabled === (this.data.trainingThresholdsEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'training_thresholds', enabled });
  }

  setMeasurementChanges(enabled: boolean): void {
    if (enabled === (this.data.measurementChangesEnabled === true)) return;
    this.bottomSheetRef.dismiss({ kind: 'measurement_changes', enabled });
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
