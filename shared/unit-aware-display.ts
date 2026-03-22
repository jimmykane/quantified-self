import {
  DataDuration,
  type DataInterface,
  DaysOfTheWeek,
  DynamicDataLoader,
  GradeAdjustedPaceUnits,
  GradeAdjustedSpeedUnits,
  PaceUnits,
  PaceUnitsToGradeAdjustedPaceUnits,
  SpeedUnits,
  SpeedUnitsToGradeAdjustedSpeedUnits,
  SwimPaceUnits,
  type UserUnitSettingsInterface,
  VerticalSpeedUnits,
} from '@sports-alliance/sports-lib';

const SECONDS_PER_DAY = 24 * 60 * 60;

export interface UnitAwareStatDisplay {
  type: string;
  value: string;
  unit: string;
  text: string;
}

function getValidEnumValues<T extends Record<string, string | number>>(enumType: T): Array<T[keyof T]> {
  return Object.values(enumType).filter((value, index, values) => {
    if (typeof value === 'number') {
      return values.indexOf(value) === index;
    }

    return typeof value === 'string' && values.indexOf(value) === index;
  }) as Array<T[keyof T]>;
}

function normalizeEnumArray<T extends string>(
  value: unknown,
  validValues: readonly T[],
  fallback: readonly T[],
): T[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const filteredValues = value.filter((entry): entry is T => validValues.includes(entry as T));
  return filteredValues.length > 0 ? filteredValues : [...fallback];
}

function toDisplayText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

export function stripTrailingDisplayUnit(displayValue: string, displayUnit: string): string {
  const value = displayValue.trim();
  const unit = displayUnit.trim();
  if (!value || !unit) {
    return value;
  }

  const lowerValue = value.toLowerCase();
  const lowerUnit = unit.toLowerCase();
  const spacedUnitSuffix = ` ${lowerUnit}`;

  if (lowerValue.endsWith(spacedUnitSuffix)) {
    return value.slice(0, value.length - spacedUnitSuffix.length).trim();
  }

  if (lowerValue.endsWith(lowerUnit)) {
    return value.slice(0, value.length - lowerUnit.length).trim();
  }

  return value;
}

function resolveGradeAdjustedSpeedUnits(speedUnits: SpeedUnits[]): GradeAdjustedSpeedUnits[] {
  return speedUnits.map((speedUnit) => {
    const mappedUnitKey = SpeedUnitsToGradeAdjustedSpeedUnits[
      speedUnit as keyof typeof SpeedUnitsToGradeAdjustedSpeedUnits
    ] as keyof typeof GradeAdjustedSpeedUnits;

    return GradeAdjustedSpeedUnits[mappedUnitKey];
  });
}

function resolveGradeAdjustedPaceUnits(paceUnits: PaceUnits[]): GradeAdjustedPaceUnits[] {
  return paceUnits.map((paceUnit) => {
    const mappedUnitKey = PaceUnitsToGradeAdjustedPaceUnits[
      paceUnit as keyof typeof PaceUnitsToGradeAdjustedPaceUnits
    ] as keyof typeof GradeAdjustedPaceUnits;

    return GradeAdjustedPaceUnits[mappedUnitKey];
  });
}

export function getDefaultUserUnitSettings(): UserUnitSettingsInterface {
  const paceUnits = [PaceUnits.MinutesPerKilometer];
  const speedUnits = [SpeedUnits.KilometersPerHour];

  return {
    speedUnits,
    gradeAdjustedSpeedUnits: resolveGradeAdjustedSpeedUnits(speedUnits),
    paceUnits,
    gradeAdjustedPaceUnits: resolveGradeAdjustedPaceUnits(paceUnits),
    swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
    verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
    startOfTheWeek: DaysOfTheWeek.Monday,
  };
}

export function normalizeUserUnitSettings(raw: unknown): UserUnitSettingsInterface {
  const defaults = getDefaultUserUnitSettings();
  const rawSettings = (raw && typeof raw === 'object')
    ? raw as Partial<UserUnitSettingsInterface>
    : {};

  const speedUnits = normalizeEnumArray(
    rawSettings.speedUnits,
    getValidEnumValues(SpeedUnits),
    defaults.speedUnits,
  );
  const paceUnits = normalizeEnumArray(
    rawSettings.paceUnits,
    getValidEnumValues(PaceUnits),
    defaults.paceUnits,
  );

  const startOfTheWeekValues = getValidEnumValues(DaysOfTheWeek).filter((value): value is DaysOfTheWeek => (
    typeof value === 'number'
  ));

  const startOfTheWeek = startOfTheWeekValues.includes(rawSettings.startOfTheWeek as DaysOfTheWeek)
    ? rawSettings.startOfTheWeek as DaysOfTheWeek
    : defaults.startOfTheWeek;

  return {
    speedUnits,
    gradeAdjustedSpeedUnits: resolveGradeAdjustedSpeedUnits(speedUnits),
    paceUnits,
    gradeAdjustedPaceUnits: resolveGradeAdjustedPaceUnits(paceUnits),
    swimPaceUnits: normalizeEnumArray(
      rawSettings.swimPaceUnits,
      getValidEnumValues(SwimPaceUnits),
      defaults.swimPaceUnits,
    ),
    verticalSpeedUnits: normalizeEnumArray(
      rawSettings.verticalSpeedUnits,
      getValidEnumValues(VerticalSpeedUnits),
      defaults.verticalSpeedUnits,
    ),
    startOfTheWeek,
  };
}

interface ResolveUnitAwareDisplayOptions {
  preferredType?: string | null;
  stripRepeatedUnit?: boolean;
}

export function resolveUnitAwareDisplayStat(
  stat: DataInterface | void | null | undefined,
  unitSettings?: UserUnitSettingsInterface | null,
  options?: ResolveUnitAwareDisplayOptions,
): UnitAwareStatDisplay | null {
  if (!stat) {
    return null;
  }

  const unitBasedStats = unitSettings
    ? DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, unitSettings)
    : [];

  const preferredStat = options?.preferredType
    ? unitBasedStats.find((unitStat) => unitStat.getType?.() === options.preferredType)
    : undefined;
  const selectedStat = preferredStat || unitBasedStats[0] || stat;
  const selectedType = selectedStat?.getType?.();
  if (!selectedType) {
    return null;
  }

  const rawValue = typeof selectedStat.getValue === 'function' ? Number(selectedStat.getValue()) : null;
  const isDuration = selectedStat instanceof DataDuration;
  const displayValueRaw = isDuration && rawValue !== null && Number.isFinite(rawValue) && rawValue >= SECONDS_PER_DAY
    ? selectedStat.getDisplayValue(true, false)
    : selectedStat.getDisplayValue?.();
  const displayUnitRaw = selectedStat.getDisplayUnit?.();
  const displayUnit = toDisplayText(displayUnitRaw).trim();
  const displayValue = options?.stripRepeatedUnit === true
    ? stripTrailingDisplayUnit(toDisplayText(displayValueRaw), displayUnit)
    : toDisplayText(displayValueRaw).trim();
  const text = displayUnit ? `${displayValue} ${displayUnit}`.trim() : displayValue;

  return {
    type: selectedType,
    value: displayValue,
    unit: displayUnit,
    text,
  };
}

export function resolveUnitAwareDisplayFromValue(
  dataType: string | undefined,
  value: unknown,
  unitSettings?: UserUnitSettingsInterface | null,
  options?: ResolveUnitAwareDisplayOptions,
): UnitAwareStatDisplay | null {
  if (!dataType) {
    return null;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  try {
    const stat = DynamicDataLoader.getDataInstanceFromDataType(dataType, numericValue);
    return resolveUnitAwareDisplayStat(stat, unitSettings, options);
  } catch (_error) {
    return null;
  }
}

export function formatUnitAwareDataValue(
  dataType: string | undefined,
  value: unknown,
  unitSettings?: UserUnitSettingsInterface | null,
  options?: ResolveUnitAwareDisplayOptions,
): string | null {
  return resolveUnitAwareDisplayFromValue(dataType, value, unitSettings, options)?.text ?? null;
}
