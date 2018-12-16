import {
  Component,
  OnChanges,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {combineLatest, EMPTY, Observable, of, Subscription} from 'rxjs';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {AppEventColorService} from '../../../services/color/app.event.color.service';
import {EventService} from '../../../services/app.event.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {UserSettingsService} from '../../../services/app.user.settings.service';
import {DataLatitudeDegrees} from 'quantified-self-lib/lib/data/data.latitude-degrees';
import {DataLongitudeDegrees} from 'quantified-self-lib/lib/data/data.longitude-degrees';
import {map, mergeMap, switchMap} from 'rxjs/operators';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
})

export class EventCardComponent implements OnInit, OnDestroy, OnChanges {
  public event: EventInterface;
  public selectedTabIndex;
  public streams: StreamInterface[] = [];
  public selectedActivities: ActivityInterface[] = [];

  public showMapAutoLaps: boolean;
  public showMapManualLaps: boolean;
  public showMapDataWarnings: boolean;
  public showData: boolean;
  public showAdvancedStats: boolean;

  public useDistanceAxis: boolean;

  private parametersSubscription: Subscription;

  constructor(
    public router: Router,
    private route: ActivatedRoute,
    private eventService: EventService,
    private userSettingsService: UserSettingsService,
    public eventColorService: AppEventColorService) {
  }

  ngOnChanges() {
    // debugger;
  }

  async ngOnInit() {
    this.userSettingsService.getShowAutoLaps().then(value => this.showMapAutoLaps = value);
    this.userSettingsService.getShowManualLaps().then(value => this.showMapManualLaps = value);
    this.userSettingsService.getShowData().then(value => this.showData = value);
    this.userSettingsService.showDataWarnings().then(value => this.showMapDataWarnings = value);
    this.userSettingsService.useDistanceAxis().then(value => this.useDistanceAxis = value);
    this.userSettingsService.showAdvancedStats().then(value => this.showAdvancedStats = value);

    // @todo test maps , switchmap etc with delete and order firing etc
    this.parametersSubscription = this.route.queryParams.pipe(map((params) => {

      this.selectedTabIndex = +params['tabIndex'];
      return params
    })).pipe(mergeMap((params) => {
      // debugger;
      // If the current event is the same then return empty
      if (this.event && this.event.getID() === params['eventID']) {
        return EMPTY
      }
      return this.eventService.getEvent(params['eventID']);
    })).pipe(map((event) => {
      // debugger;
      if (!event) {
        return
      }
      this.event = event;
      this.selectedActivities = event.getActivities();
    }))
    //   .pipe(map((activities) => {
    //   return activities.reduce((activityStreamPairArray, activity) => {
    //     activityStreamPairArray.push({
    //         activity: activity,
    //         activityStreams: this.eventService.getStreams(this.event.getID(), activity.getID(), ['Latitude', 'Longitude']),
    //       });
    //     return activityStreamPairArray
    //   }, [])
    // })).pipe(mergeMap((activityStreamPairArray) => {
    //   return combineLatest(activityStreamPairArray.reduce((flattenedArray, activityStreamPair) => {
    //     flattenedArray.push(of(activityStreamPair.activity), activityStreamPair.activityStreams);
    //     return flattenedArray
    //   }, []))
    // })).pipe(map((resultsArray) => {
    //   resultsArray.forEach((arrayElement, index, array) => {
    //     if (index %2 ===0 ){
    //       (<ActivityInterface>array[index]).streams.push(<StreamInterface>array[index+1])
    //     }
    //   })
    // }))
      .subscribe()

    // // Perhaps this should be a combine latest


    // // Subscribe to route changes
    // this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
    //   this.selectedTabIndex = +params['tabIndex'];
    //
    //   // If there is an ID change then unsubscribe and resubscribe to the new id
    //   if (this.eventID !== params['eventID']) {
    //     debugger;
    //     this.eventID = params['eventID'];
    //     if (this.eventSubscription) {
    //       this.eventSubscription.unsubscribe();
    //     }
    //     this.selectedActivities = [];
    //     // Subscribe to event changes
    //     this.eventSubscription = this.eventService.getEvent(this.eventID).subscribe((event: EventInterface) => {
    //       this.event = event;
    //       event.getActivities().forEach((activity)=> {
    //         this.eventService.getStreams(event.getID(), activity.getID(), [DataLatitudeDegrees.type, DataLongitudeDegrees.type])
    //       });
    //       this.selectedActivities = this.selectedActivities.length ? this.selectedActivities : this.event.getActivities();
    //     });
    //   }
    // });
  }

  ngOnDestroy(): void {
    this.parametersSubscription.unsubscribe();
  }

  hasLaps(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((lapsArray, activity) => lapsArray.concat(activity.getLaps()), []).length
  }
}
