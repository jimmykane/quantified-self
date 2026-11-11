import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CalendarActivityRow } from '../../../helpers/calendar-activity-row.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { ActivityTypeIconComponent } from '../../activity-type-icon/activity-type-icon.component';
import { TrainingImpactComponent } from '../../training-impact/training-impact.component';
import { CalendarActivityTagsComponent } from '../calendar-activity-tags/calendar-activity-tags.component';

@Component({
  selector: 'app-calendar-activity-row',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, ActivityTypeIconComponent, TrainingImpactComponent, CalendarActivityTagsComponent],
  templateUrl: './calendar-activity-row.component.html',
  styleUrl: './calendar-activity-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarActivityRowComponent {
  readonly activity = input.required<CalendarActivityRow>();
  readonly navigationRequested = output<void>();
  private readonly haptics = inject(AppHapticsService);

  prepareNavigation(): void {
    this.haptics.selection();
    this.navigationRequested.emit();
  }
}
