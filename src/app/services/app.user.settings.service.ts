import {Injectable} from '@angular/core';
import {Log} from 'ng2-logger/browser';
import {MapSettingsLocalStorageService} from './storage/app.map.settings.local.storage.service';
import {ChartSettingsLocalStorageService} from './storage/app.chart.settings.local.storage.service';


@Injectable()
export class UserSettingsService {
  protected logger = Log.create('UserSettingsService');

  constructor(private mapSettingsLocalStorageService: MapSettingsLocalStorageService,
              private chartSettingsLocalStorageService: ChartSettingsLocalStorageService) {
  }

  public async showAutoLaps(): Promise<boolean> {
    let defaultValue = 'false';
    try {
      defaultValue = await this.mapSettingsLocalStorageService.getItem('showAutoLaps');
    } catch (e) {
      this.mapSettingsLocalStorageService.setItem('showAutoLaps', defaultValue);
    }
    return defaultValue === 'true';
  }

  public async showManualLaps(): Promise<boolean> {
    let defaultValue = 'false';
    try {
      defaultValue = await this.mapSettingsLocalStorageService.getItem('showManualLaps');
    } catch (e) {
      this.mapSettingsLocalStorageService.setItem('showManualLaps', defaultValue);
    }
    return defaultValue === 'true';
  }

  public async useDistanceAxis(): Promise<boolean> {
    let defaultValue = 'false';
    try {
      defaultValue = await this.chartSettingsLocalStorageService.getItem('useDistanceAxis');
    } catch (e) {
      this.chartSettingsLocalStorageService.setItem('useDistanceAxis', defaultValue);
    }
    return defaultValue === 'true';
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

  public setShowAutoLaps(value: boolean) {
    this.mapSettingsLocalStorageService.setItem('showAutoLaps', String(value));
  }

  public setShowManualLaps(value: boolean) {
    this.mapSettingsLocalStorageService.setItem('showManualLaps', String(value));
  }

  public setUseDistanceAxis(value: boolean) {
    this.chartSettingsLocalStorageService.setItem('useDistanceAxis', String(value));
  }

  public setShowAllData(value: boolean) {
    this.chartSettingsLocalStorageService.setItem('showAllData', String(value));
  }
}

