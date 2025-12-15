import {
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output
} from '@angular/core';
import {EventInterface} from '@sports-alliance/sports-lib';
import {ActivityInterface} from '@sports-alliance/sports-lib';
import {AppEventColorService} from '../../../services/color/app.event.color.service';
import {AppActivitySelectionService} from '../../../services/activity-selection-service/app-activity-selection.service';
import {Subscription} from 'rxjs';
import {MatSlideToggleChange} from '@angular/material/slide-toggle';
import {User} from '@sports-alliance/sports-lib';

@Component({
    selector: 'app-activity-toggle',
    templateUrl: './activity-toggle.component.html',
    styleUrls: ['./activity-toggle.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})

export class ActivityToggleComponent implements OnChanges, OnInit, OnDestroy {
  @Input() isOwner?: boolean;
  @Input() event: EventInterface;
  @Input() activity: ActivityInterface;
  @Input() user: User;
  @Input() showToggle = true;
  @Input() showActions?: boolean;
  @Input() showDate = true;
  @Input() showStats = true;

  private selectedActivitiesSubscription: Subscription;
  private selectedActivities: ActivityInterface[];

  constructor(
    public eventColorService: AppEventColorService,
    public activitySelectionService: AppActivitySelectionService,
    private changeDetectorRef: ChangeDetectorRef,
  ) {
  }

  ngOnInit() {
    this.selectedActivitiesSubscription = this.activitySelectionService.selectedActivities.changed.asObservable()
      .subscribe((selectedActivities) => {
        this.selectedActivities = selectedActivities.source.selected;
        this.changeDetectorRef.detectChanges();
      })
  }

  ngOnChanges(simpleChanges): void {
  }

  onActivitySelect(event: MatSlideToggleChange, activity: ActivityInterface) {
    event.checked ?
      this.activitySelectionService.selectedActivities.select(activity)
      : this.activitySelectionService.selectedActivities.deselect(activity);
  }


  onActivityClick(event, activity: ActivityInterface) {
    this.activitySelectionService.selectedActivities.isSelected(activity)
    ? this.activitySelectionService.selectedActivities.deselect(activity)
      : this.activitySelectionService.selectedActivities.select(activity);
  }

  ngOnDestroy(): void {
    if (this.selectedActivitiesSubscription) {
      this.selectedActivitiesSubscription.unsubscribe();
    }
  }
}
