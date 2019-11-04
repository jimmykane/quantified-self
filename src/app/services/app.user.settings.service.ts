import {Injectable} from '@angular/core';
import {Log} from 'ng2-logger/browser';
import {MapSettingsLocalStorageService} from './storage/app.map.settings.local.storage.service';
import {ChartSettingsLocalStorageService} from './storage/app.chart.settings.local.storage.service';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';


@Injectable()
export class UserSettingsService {
  protected logger = Log.create('UserSettingsService');

  constructor(private mapSettingsLocalStorageService: MapSettingsLocalStorageService,
              private chartSettingsLocalStorageService: ChartSettingsLocalStorageService) {
  }

  public async showAllData(): Promise<boolean> {
    let defaultValue = 'false';
    try {
      defaultValue = await this.chartSettingsLocalStorageService.getItem('showAllData');
    } catch (e) {
      this.chartSettingsLocalStorageService.setItem('showAllData', defaultValue);
    }
    return defaultValue === 'true';
  }

  public async selectedDataTypes(event: EventInterface): Promise<string[]> {
    let defaultValue = [];
    try {
      const stringValue = await this.chartSettingsLocalStorageService.getItem(`selectedDataTypes${event.getID()}`);
      defaultValue = stringValue !== 'null' ? stringValue.split(',') : defaultValue;
    } catch (e) {
      this.chartSettingsLocalStorageService.setItem(`selectedDataTypes${event.getID()}`, null);
    }
    return defaultValue;
  }

  public setShowAllData(value: boolean) {
    this.chartSettingsLocalStorageService.setItem('showAllData', String(value));
  }

  public setSelectedDataTypes(event: EventInterface, selectedDataTypes: string[]) {
    this.chartSettingsLocalStorageService.setItem(`selectedDataTypes${event.getID()}`, selectedDataTypes.join(','));
  }
}

