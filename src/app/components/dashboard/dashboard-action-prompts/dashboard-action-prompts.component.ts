import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  AppDashboardActionPromptId,
} from '../../../models/app-user.interface';
import {
  DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID,
  DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID,
  DashboardActionPromptControlChange,
  DashboardActionPromptEvent,
  DashboardActionPromptMenuEvent,
  DashboardActionPromptViewModel,
} from '../../../helpers/dashboard-action-prompt.helper';
import { UnitSetupPreset, UnitSetupPresetOption } from '../../../helpers/unit-setup-preset.helper';
import { AppUserInterface } from '../../../models/app-user.interface';

@Component({
  selector: 'app-dashboard-action-prompts',
  templateUrl: './dashboard-action-prompts.component.html',
  styleUrls: ['./dashboard-action-prompts.component.scss'],
  standalone: false,
})
export class DashboardActionPromptsComponent {
  @Input()
  set prompts(value: DashboardActionPromptViewModel[] | null | undefined) {
    this._prompts = value || [];
    this.syncOrderedPrompts();
  }

  get prompts(): DashboardActionPromptViewModel[] {
    return this._prompts;
  }

  @Input() unitSetupOptions: readonly UnitSetupPresetOption[] = [];
  @Input() selectedUnitSetupPreset: UnitSetupPreset | null = null;
  @Input() user: AppUserInterface | null = null;

  @Output() primary = new EventEmitter<DashboardActionPromptEvent>();
  @Output() secondary = new EventEmitter<DashboardActionPromptEvent>();
  @Output() menuAction = new EventEmitter<DashboardActionPromptMenuEvent>();
  @Output() controlChange = new EventEmitter<DashboardActionPromptControlChange>();

  public orderedPrompts: DashboardActionPromptViewModel[] = [];
  public readonly unitSetupPromptId = DASHBOARD_ACTION_PROMPT_UNIT_SETUP_ID;
  public readonly firstActivityUploadPromptId = DASHBOARD_ACTION_PROMPT_FIRST_ACTIVITY_UPLOAD_ID;

  private _prompts: DashboardActionPromptViewModel[] = [];
  private readonly promptOrder: Record<AppDashboardActionPromptId, number> = {
    unitSetup: 0,
    firstActivityUpload: 1,
    connectActivityService: 2,
    enableActivityAutoSync: 3,
    backfillGarminSleep: 4,
    reconnectSuuntoService: 5,
  };

  private syncOrderedPrompts(): void {
    this.orderedPrompts = [...this._prompts].sort((left, right) => (
      (this.promptOrder[left.id] ?? 999) - (this.promptOrder[right.id] ?? 999)
    ));
  }

  onControlChange(promptId: AppDashboardActionPromptId, value: unknown): void {
    this.controlChange.emit({ promptId, value });
  }
}
