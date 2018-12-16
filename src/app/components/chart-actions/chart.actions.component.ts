import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import {Router} from '@angular/router';
import {EventService} from '../../services/app.event.service';
import {UserSettingsService} from '../../services/app.user.settings.service';

@Component({
  selector: 'app-chart-actions',
  templateUrl: './chart.actions.component.html',
  styleUrls: ['./chart.actions.component.css'],
  providers: [],
})

export class ChartActionsComponent implements OnChanges {

  @Input() useDistanceAxis: boolean;
  @Input() showAdvancedStats: boolean;

  @Output() showAdvancedStatsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() useDistanceAxisChange: EventEmitter<boolean> = new EventEmitter<boolean>();

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private userSettingsService: UserSettingsService) {
  }

  checkBoxChanged(event) {
    this.useDistanceAxisChange.emit(this.useDistanceAxis);
    this.showAdvancedStatsChange.emit(this.showAdvancedStats);
    this.userSettingsService.setUseDistanceAxis(this.useDistanceAxis);
    this.userSettingsService.setShowAdvancedStats(this.showAdvancedStats);
    // this.changeDetectorRef.detectChanges()
    // this.changeDetectorRef.markForCheck()
  }

  ngOnChanges(simpleChanges) {
  }
}
