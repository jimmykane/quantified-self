import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy} from '@angular/core';
import {EventInterface} from '../../../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {WeatherUndergroundWeatherService} from '../../../../../services/weather/app.weather-underground.weather.service';
import {Weather} from '../../../../../entities/weather/app.weather';

@Component({
  selector: 'app-card-map-weather',
  templateUrl: './event.card.map.weather.component.html',
  styleUrls: ['./event.card.map.weather.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush

})
export class EventCardMapWeatherComponent {
  @Input() event: EventInterface;
}

