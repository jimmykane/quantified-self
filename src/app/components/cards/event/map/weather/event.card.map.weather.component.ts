import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy} from '@angular/core';
import {EventInterface} from '../../../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {WeatherUndergroundWeatherService} from '../../../../../services/weather/app.weather-underground.weather.service';
import {Weather} from '../../../../../services/weather/app.weather';

@Component({
  selector: 'app-card-map-weather',
  templateUrl: './event.card.map.weather.component.html',
  styleUrls: ['./event.card.map.weather.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush

})
export class EventCardMapWeatherComponent implements OnChanges, OnDestroy {
  @Input() event: EventInterface;

  weather: Weather;

  private weatherSubscription: Subscription;

  constructor(private weatherService: WeatherUndergroundWeatherService, private changeDetectorRef: ChangeDetectorRef) {
  }

  ngOnChanges() {
    if (this.weatherSubscription) {
      this.weatherSubscription.unsubscribe();
    }
    this.weatherSubscription = this.weatherService.getWeatherForEvent(this.event).subscribe((weather: Weather) => {
      this.weather = weather;
      this.changeDetectorRef.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.weatherSubscription.unsubscribe();
  }

}

