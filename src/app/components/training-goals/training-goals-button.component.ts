import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SharedModule } from '../../modules/shared.module';
import { TrainingGoalsService } from '../../services/training-goals.service';
@Component({ selector: 'app-training-goals-button', standalone: true, imports: [SharedModule],
  template: `@if (isOwner()) { <button mat-button appHapticTap type="button" class="goals-button" aria-label="Goals" matTooltip="Goals"
    (click)="goals.open(uid()!)"><mat-icon aria-hidden="true">flag</mat-icon><span>Goals</span></button> }`,
  styleUrl: './training-goals-button.component.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class TrainingGoalsButtonComponent {
  readonly uid = input<string | null | undefined>(null);
  readonly goals = inject(TrainingGoalsService);
  readonly isOwner = computed(() => this.goals.isOwner(this.uid() ?? ''));
}
