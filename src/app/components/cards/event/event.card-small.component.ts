import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {GeoLocationInfoService} from "../../../services/geo-location/app.geo-location-info.service";
import {GeoLocationInfo} from "../../../services/geo-location/app.geo-location-info";


@Component({
  selector: 'app-event-card-small',
  templateUrl: './event.card-small.component.html',
  styleUrls: ['./event.card-small.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardSmallComponent implements OnInit, OnDestroy {
  @Input() event: EventInterface;
  @Input() classActive: boolean;
  public geoLocationInfo: GeoLocationInfo;

  private parametersSubscription: Subscription;

  constructor(private changeDetectorRef: ChangeDetectorRef,
              private route: ActivatedRoute, private router: Router,
              private geoLocationInfoService: GeoLocationInfoService) {
  }

  ngOnInit() {
    // Subscribe to route changes
    this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
    });
    this.geoLocationInfoService.getGeoLocationInfo(this.event.getFirstActivity().getStartPoint().getPosition())
      .then((geoLocationInfo) => {
        this.geoLocationInfo = geoLocationInfo;
        this.changeDetectorRef.detectChanges();
      })
      .catch(() => {});
  }

  ngOnDestroy(): void {
    this.parametersSubscription.unsubscribe();
  }
}
