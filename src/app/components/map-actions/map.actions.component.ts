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
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {EventFormComponent} from '../event-form/event.form.component';
import {MatDialog, MatSnackBar} from '@angular/material';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {UserSettingsService} from '../../services/app.user.settings.service';

@Component({
  selector: 'app-map-actions',
  templateUrl: './map.actions.component.html',
  styleUrls: ['./map.actions.component.css'],
  providers: [],
})

export class MapActionsComponent implements OnChanges {

  @Input() showAutoLaps: boolean;
  @Input() showManualLaps: boolean;
  @Input() showData: boolean;
  @Input() showDataWarnings: boolean;

  @Output() showAutoLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showManualLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showDataChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showDataWarningsChange: EventEmitter<boolean> = new EventEmitter<boolean>();


  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private mapSettingsService: UserSettingsService,
    private snackBar: MatSnackBar,
    public dialog: MatDialog) {
  }

  checkBoxChanged(event) {
    // debugger;
    this.showAutoLapsChange.emit(this.showAutoLaps);
    this.showManualLapsChange.emit(this.showManualLaps);
    this.showDataChange.emit(this.showData);
    this.showDataWarningsChange.emit(this.showDataWarnings);
    this.mapSettingsService.setShowAutoLaps(this.showAutoLaps);
    this.mapSettingsService.setShowManualLaps(this.showManualLaps);
    this.mapSettingsService.setShowData(this.showData);
    this.mapSettingsService.setShowDataWarnings(this.showDataWarnings);
    // this.changeDetectorRef.detectChanges()
    // this.changeDetectorRef.markForCheck()
  }

  ngOnChanges(simpleChanges) {
    // debugger;
  }
}
