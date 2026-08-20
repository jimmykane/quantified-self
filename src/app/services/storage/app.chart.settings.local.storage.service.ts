import {Injectable} from '@angular/core';
import {LocalStorageService} from './app.local.storage.service';
import {EventInterface} from '@sports-alliance/sports-lib';
import {getEventChartSelectionKey} from '../../helpers/event-chart-sport-profile.helper';

export type EventChartVisibilityMode = 'automatic' | 'custom';

export interface EventChartVisibilityPreference {
  mode: EventChartVisibilityMode;
  selectionKeys: string[];
  source: 'signature' | 'legacy' | 'default';
}

interface StoredEventChartVisibilityPreference {
  mode: EventChartVisibilityMode;
  selectionKeys?: string[];
}

interface EventChartVisibilityStateV2 {
  version: 2;
  legacySelectionKeys?: string[];
  byActivityTypeSignature: Record<string, StoredEventChartVisibilityPreference>;
}


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

  public getDataTypeIDsToShow(event: EventInterface): string[] {
    return this.getSeriesIDsToShow(event);
  }

  public setDataTypeIDsToShow(event: EventInterface, dataTypeIDs: string[]) {
    this.setSeriesIDsToShow(event, dataTypeIDs);
  }

  public showDataTypeID(event: EventInterface, dataTypeID: string) {
    this.showSeriesID(event, dataTypeID);
  }

  public hideDataTypeID(event: EventInterface, dataTypeID: string) {
    this.hideSeriesID(event, dataTypeID);
  }

  public getEventChartVisibilityPreference(
    event: EventInterface,
    activityTypeSignature: string,
  ): EventChartVisibilityPreference {
    const state = this.getOrMigrateVisibilityState(event);
    const signaturePreference = state?.byActivityTypeSignature[activityTypeSignature];

    if (signaturePreference) {
      return {
        mode: signaturePreference.mode,
        selectionKeys: signaturePreference.mode === 'custom'
          ? normalizeSelectionKeys(signaturePreference.selectionKeys || [])
          : [],
        source: 'signature',
      };
    }

    if (state?.legacySelectionKeys?.length) {
      return {
        mode: 'custom',
        selectionKeys: [...state.legacySelectionKeys],
        source: 'legacy',
      };
    }

    return {mode: 'automatic', selectionKeys: [], source: 'default'};
  }

  public setEventChartCustomVisibilityPreference(
    event: EventInterface,
    activityTypeSignature: string,
    dataTypeIDs: readonly string[],
  ): void {
    const state = this.getOrMigrateVisibilityState(event) || createVisibilityState();
    state.byActivityTypeSignature[activityTypeSignature] = {
      mode: 'custom',
      selectionKeys: normalizeSelectionKeys(dataTypeIDs),
    };
    this.setVisibilityState(event, state);
  }

  public resetEventChartVisibilityPreference(
    event: EventInterface,
    activityTypeSignature: string,
  ): void {
    const state = this.getOrMigrateVisibilityState(event);
    if (!state) {
      return;
    }

    if (state.legacySelectionKeys?.length) {
      state.byActivityTypeSignature[activityTypeSignature] = {mode: 'automatic'};
      this.setVisibilityState(event, state);
      return;
    }

    delete state.byActivityTypeSignature[activityTypeSignature];
    if (Object.keys(state.byActivityTypeSignature).length === 0) {
      this.removeItem(this.getVisibilityStateKey(event));
    } else {
      this.setVisibilityState(event, state);
    }
  }

  private getOrMigrateVisibilityState(event: EventInterface): EventChartVisibilityStateV2 | null {
    const storedState = this.readVisibilityState(event);
    const legacySelectionKeys = normalizeSelectionKeys(this.getDataTypeIDsToShow(event));

    if (storedState) {
      if (!storedState.legacySelectionKeys?.length && legacySelectionKeys.length) {
        storedState.legacySelectionKeys = legacySelectionKeys;
        this.setVisibilityState(event, storedState);
      }
      return storedState;
    }

    if (!legacySelectionKeys.length) {
      return null;
    }

    const migratedState = createVisibilityState();
    migratedState.legacySelectionKeys = legacySelectionKeys;
    this.setVisibilityState(event, migratedState);
    return migratedState;
  }

  private readVisibilityState(event: EventInterface): EventChartVisibilityStateV2 | null {
    const storedValue = this.getItem(this.getVisibilityStateKey(event));
    if (!storedValue) {
      return null;
    }

    try {
      const value = JSON.parse(storedValue) as Partial<EventChartVisibilityStateV2>;
      if (value.version !== 2 || !isPreferenceRecord(value.byActivityTypeSignature)) {
        return null;
      }
      return {
        version: 2,
        legacySelectionKeys: normalizeSelectionKeys(value.legacySelectionKeys || []),
        byActivityTypeSignature: normalizePreferenceRecord(value.byActivityTypeSignature),
      };
    } catch {
      return null;
    }
  }

  private setVisibilityState(event: EventInterface, state: EventChartVisibilityStateV2): void {
    this.setItem(this.getVisibilityStateKey(event), JSON.stringify(state));
  }

  private getVisibilityStateKey(event: EventInterface): string {
    return `selectedDataTypesV2${event.getID()}`;
  }
}

function createVisibilityState(): EventChartVisibilityStateV2 {
  return {version: 2, byActivityTypeSignature: {}};
}

function normalizeSelectionKeys(dataTypeIDs: readonly unknown[]): string[] {
  return [...new Set(dataTypeIDs
    .filter((dataTypeID): dataTypeID is string => typeof dataTypeID === 'string')
    .map(getEventChartSelectionKey)
    .filter(Boolean))];
}

function isPreferenceRecord(value: unknown): value is Record<string, StoredEventChartVisibilityPreference> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePreferenceRecord(
  value: Record<string, StoredEventChartVisibilityPreference>,
): Record<string, StoredEventChartVisibilityPreference> {
  return Object.fromEntries(Object.entries(value).flatMap(([signature, preference]) => {
    if (!preference || (preference.mode !== 'automatic' && preference.mode !== 'custom')) {
      return [];
    }
    return [[signature, preference.mode === 'custom'
      ? {mode: 'custom', selectionKeys: normalizeSelectionKeys(preference.selectionKeys || [])}
      : {mode: 'automatic'}]];
  }));
}
