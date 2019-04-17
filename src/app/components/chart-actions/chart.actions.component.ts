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
  @Input() useDurationAxis: boolean;
  @Input() showAllData: boolean;
  @Input() dataSmoothingLevel: number;

  @Output() showAllDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() useDistanceAxisChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() useDurationAxisChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() dataSmoothingLevelChange: EventEmitter<number> = new EventEmitter<number>();

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private userSettingsService: UserSettingsService) {
  }

  somethingChanged(event) {
    this.useDistanceAxisChange.emit(this.useDistanceAxis);
    this.useDurationAxisChange.emit(this.useDurationAxis);
    this.showAllDataChange.emit(this.showAllData);
    this.dataSmoothingLevelChange.emit(this.dataSmoothingLevel);
    this.userSettingsService.setUseDistanceAxis(this.useDistanceAxis);
    this.userSettingsService.setUseDurationAxis(this.useDurationAxis);
    this.userSettingsService.setShowAllData(this.showAllData);
    // this.changeDetectorRef.detectChanges()
    // this.changeDetectorRef.markForCheck()
  }

  formatLabel(value: number | null) {
    if (!value){
      return '';
    }
    return `${((value -1)  *100 /20).toFixed(0) }%`
  }

  ngOnChanges(simpleChanges) {
  }
}
