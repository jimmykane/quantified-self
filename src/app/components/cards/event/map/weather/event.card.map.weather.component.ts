import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy} from '@angular/core';
import {EventInterface} from '../../../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {WeatherService} from '../../../../../services/weather/app.weather.service';
import {WeatherItem} from '../../../../../services/weather/app.weather.item';

@Component({
  selector: 'app-card-map-weather',
  templateUrl: './event.card.map.weather.component.html',
  styleUrls: ['./event.card.map.weather.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush

})
export class EventCardMapWeatherComponent implements OnChanges, OnDestroy {
  @Input() event: EventInterface;

  weatherData: WeatherItem[] = [];

  private weatherSubscription: Subscription;

  constructor(private weatherService: WeatherService, private changeDetectorRef: ChangeDetectorRef) {
  }

  ngOnChanges() {
    if (this.weatherSubscription) {
      this.weatherSubscription.unsubscribe();
    }
    this.weatherSubscription = this.weatherService.getWeatherForEvent(this.event).subscribe((data) => {
      this.weatherData = data;
      this.changeDetectorRef.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.weatherSubscription.unsubscribe();
  }

}

