import { Injectable } from '@angular/core';
import { EventSummaryMetricGroupId } from '../../constants/event-summary-metric-groups';
import { LocalStorageService } from './app.local.storage.service';

@Injectable({
  providedIn: 'root',
})
export class AppEventSummaryTabsLocalStorageService extends LocalStorageService {
  protected nameSpace = 'event.summary.tabs.';

  private readonly lastSelectedStatsTabIdKey = 'lastSelectedStatsTabId';

  public getLastSelectedStatsTabId(): string {
    return this.getItem(this.lastSelectedStatsTabIdKey);
  }

  public setLastSelectedStatsTabId(tabId: EventSummaryMetricGroupId): void {
    this.setItem(this.lastSelectedStatsTabIdKey, tabId);
  }

  public clearLastSelectedStatsTabId(): void {
    this.removeItem(this.lastSelectedStatsTabIdKey);
  }
}
