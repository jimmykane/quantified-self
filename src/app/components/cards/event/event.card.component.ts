import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {AppEventColorService} from "../../../services/app.event.color.service";
import {ActivityInterface} from "../../../entities/activities/activity.interface";


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardComponent implements OnInit, OnDestroy {
  @Input() event: EventInterface;
  selectedTabIndex;

  private parametersSubscription: Subscription;

  constructor(private route: ActivatedRoute, private router: Router, public eventColorService: AppEventColorService) {
  }

  selectedTabIndexChange(index) {
    this.router.navigate(['/dashboard'], {queryParams: {eventID: this.event.getID(), tabIndex: index}});
  }

  ngOnInit() {
    // Subscribe to route changes
    this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
      this.selectedTabIndex = +params['tabIndex'];
    });
  }

  ngOnDestroy(): void {
    this.parametersSubscription.unsubscribe();
  }

  hasIBIData(event: EventInterface) {
    return event.getActivities().find((activity: ActivityInterface) => {
      return activity.ibiData && !!activity.ibiData.getIBIDataMap().size;
    })
  }
}
