import {Injectable} from '@angular/core';
import {LocalStorageService} from './app.local.storage.service';
import {EventInterface} from '@sports-alliance/sports-lib';


@Injectable({
  providedIn: 'root',
})
export class AppChartSettingsLocalStorageService extends LocalStorageService {
  protected nameSpace = 'chart.settings.service.';


  // @todo perhaps make static
  public getSeriesIDsToShow(event: EventInterface): string[] {
    const stringValue = this.getItem(`selectedDataTypes${event.getID()}`);
    return stringValue ? stringValue.split(',') : [];
  }

  public setSeriesIDsToShow(event: EventInterface, seriesIDs: string[]) {
    this.setItem(`selectedDataTypes${event.getID()}`, seriesIDs.join(','));
  }

  public showSeriesID(event: EventInterface, seriesID: string) {
    const seriesToShow = this.getSeriesIDsToShow(event);
    if (seriesToShow.indexOf(seriesID) === -1) {
      seriesToShow.push(seriesID);
    }
    this.setSeriesIDsToShow(event, seriesToShow);
  }

  public hideSeriesID(event: EventInterface, seriesID: string) {
    const seriesToShow = this.getSeriesIDsToShow(event);
    if (seriesToShow.indexOf(seriesID) !== -1) {
      seriesToShow.splice(seriesToShow.indexOf(seriesID), 1);
    }
    this.setSeriesIDsToShow(event, seriesToShow);
  }
}
