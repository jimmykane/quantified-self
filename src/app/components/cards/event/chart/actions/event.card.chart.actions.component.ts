import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import {Router} from '@angular/router';
import {EventService} from '../../../../../services/app.event.service';
import {UserSettingsService} from '../../../../../services/app.user.settings.service';
import {XAxisTypes} from 'quantified-self-lib/lib/users/user.chart.settings.interface';

@Component({
  selector: 'app-event-card-chart-actions',
  templateUrl: './event.card.chart.actions.component.html',
  styleUrls: ['./event.card.chart.actions.component.css'],
  providers: [],
})

export class EventCardChartActionsComponent implements OnChanges {
  @Input() xAxisType: XAxisTypes;
  @Input() showAllData: boolean;
  @Input() dataSmoothingLevel: number;
  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() xAxisTypeChange: EventEmitter<XAxisTypes> = new EventEmitter<XAxisTypes>();
  @Output() dataSmoothingLevelChange: EventEmitter<number> = new EventEmitter<number>();

  public xAxisTypes = XAxisTypes;

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private userSettingsService: UserSettingsService) {
  }

  somethingChanged(event) {
    this.xAxisTypeChange.emit(this.xAxisType);
    this.showAllDataChange.emit(this.showAllData);
    this.dataSmoothingLevelChange.emit(this.dataSmoothingLevel);
    this.userSettingsService.setShowAllData(this.showAllData);
  }

  formatLabel(value: number | null) {
    if (!value) {
      return '';
    }
    return `${((value - 1) * 100 / 20).toFixed(0)}%`
  }

  ngOnChanges(simpleChanges) {
  }
}
