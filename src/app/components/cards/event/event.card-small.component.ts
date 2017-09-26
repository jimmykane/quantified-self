import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {GeoLocationInfoService} from '../../../services/geo-location/app.geo-location-info.service';
import {GeoLocationInfo} from '../../../entities/geo-location-info/app.geo-location-info';
import {Log, Level} from 'ng2-logger'


@Component({
  selector: 'app-event-card-small',
  templateUrl: './event.card-small.component.html',
  styleUrls: ['./event.card-small.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardSmallComponent {
  @Input() event: EventInterface;
  @Input() classActive: boolean;
}
