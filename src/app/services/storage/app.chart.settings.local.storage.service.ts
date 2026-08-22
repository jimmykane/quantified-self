import {Injectable} from '@angular/core';
import {LocalStorageService} from './app.local.storage.service';
import {EventInterface} from '@sports-alliance/sports-lib';
import {getEventChartSelectionKey} from '../../helpers/event-chart-sport-profile.helper';

export type EventChartVisibilityMode = 'automatic' | 'custom';

export interface EventChartVisibilityPreference {
  mode: EventChartVisibilityMode;
  selectionKeys: string[];
}

interface StoredEventChartVisibilityPreference {
  mode: EventChartVisibilityMode;
  selectionKeys?: string[];
}

interface EventChartVisibilityStateV2 {
  version: 2;
  byActivityTypeSignature: Record<string, StoredEventChartVisibilityPreference>;
}


@Injectable({
  providedIn: 'root',
})
export class AppChartSettingsLocalStorageService extends LocalStorageService {
  protected nameSpace = 'chart.settings.service.';

  public getEventChartVisibilityPreference(
    event: EventInterface,
    activityTypeSignature: string,
  ): EventChartVisibilityPreference {
    const state = this.readVisibilityState(event);
    const signaturePreference = state?.byActivityTypeSignature[activityTypeSignature];

    if (signaturePreference) {
      return {
        mode: signaturePreference.mode,
        selectionKeys: signaturePreference.mode === 'custom'
          ? normalizeSelectionKeys(signaturePreference.selectionKeys || [])
          : [],
      };
    }

    return {mode: 'automatic', selectionKeys: []};
  }

  public setEventChartCustomVisibilityPreference(
    event: EventInterface,
    activityTypeSignature: string,
    dataTypeIDs: readonly string[],
  ): void {
    const state = this.readVisibilityState(event) || createVisibilityState();
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
    const state = this.readVisibilityState(event);
    if (!state) {
      return;
    }

    delete state.byActivityTypeSignature[activityTypeSignature];
    if (Object.keys(state.byActivityTypeSignature).length === 0) {
      this.removeItem(this.getVisibilityStateKey(event));
    } else {
      this.setVisibilityState(event, state);
    }
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
