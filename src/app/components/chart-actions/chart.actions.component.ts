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
  @Input() showAllData: boolean;
  @Input() showOnlyOneYAxis: boolean;

  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() useDistanceAxisChange: EventEmitter<boolean> = new EventEmitter<boolean>();

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private userSettingsService: UserSettingsService) {
  }

  checkBoxChanged(event) {
    this.useDistanceAxisChange.emit(this.useDistanceAxis);
    this.showAllDataChange.emit(this.showAllData);
    this.userSettingsService.setUseDistanceAxis(this.useDistanceAxis);
    this.userSettingsService.setShowAllData(this.showAllData);
    // this.changeDetectorRef.detectChanges()
    // this.changeDetectorRef.markForCheck()
  }

  ngOnChanges(simpleChanges) {
  }
}
