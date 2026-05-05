import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  DashboardActionPromptEvent,
  DashboardActionPromptMenuEvent,
  DashboardActionPromptViewModel,
} from '../../../helpers/dashboard-action-prompt.helper';

@Component({
  selector: 'app-dashboard-action-prompt',
  templateUrl: './dashboard-action-prompt.component.html',
  styleUrls: ['./dashboard-action-prompt.component.scss'],
  standalone: false,
})
export class DashboardActionPromptComponent {
  @Input() prompt: DashboardActionPromptViewModel | null = null;
  @Input() hasControls = false;
  @Input() hasActionControls = false;

  @Output() primary = new EventEmitter<DashboardActionPromptEvent>();
  @Output() secondary = new EventEmitter<DashboardActionPromptEvent>();
  @Output() menuAction = new EventEmitter<DashboardActionPromptMenuEvent>();

  emitPrimary(): void {
    if (!this.prompt?.primaryAction || this.prompt.busy) {
      return;
    }

    this.primary.emit({
      promptId: this.prompt.id,
      action: this.prompt.primaryAction,
    });
  }

  emitSecondary(): void {
    if (!this.prompt?.secondaryAction || this.prompt.busy) {
      return;
    }

    this.secondary.emit({
      promptId: this.prompt.id,
      action: this.prompt.secondaryAction,
    });
  }

  emitMenuAction(action: DashboardActionPromptMenuEvent['action']): void {
    if (!this.prompt || this.prompt.busy) {
      return;
    }

    this.menuAction.emit({
      promptId: this.prompt.id,
      action,
    });
  }
}
