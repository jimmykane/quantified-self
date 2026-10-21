import { DataDistance, DataDistanceMiles, DynamicDataLoader, Stream, type StreamInterface, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';

const groups = DynamicDataLoader.dataTypeUnitGroups;
const owners = new Map<string, string[]>();
Object.entries(groups).forEach(([source, variants]) => Object.keys(variants).forEach(variant => {
  owners.set(variant, [...(owners.get(variant) ?? []), source]);
}));

/** Only unambiguous unit aliases identify the same source. Generic miles is recorded Distance. */
export function getEventChartUnitSource(type: string): string {
  if (Object.prototype.hasOwnProperty.call(groups, type)) return type;
  if (type === DataDistanceMiles.type) return DataDistance.type;
  const sources = owners.get(type);
  return sources?.length === 1 ? sources[0] : type;
}

/** Several distance sources share a generic variant; keep their own identity and format at display time. */
export function retainEventChartSourceValues(type: string): boolean {
  return Object.keys(Object.prototype.hasOwnProperty.call(groups, type) ? groups[type] : {}).some(variant => getEventChartUnitSource(variant) !== type);
}

export function getEventChartUnitTypes(types: string[], settings: UserUnitSettingsInterface, includeDerivedTypes: boolean): string[] {
  const recordedTypes = new Set(types);
  const convertible = types.filter(type => {
    if (retainEventChartSourceValues(type)) return false;
    const source = getEventChartUnitSource(type);
    // When a canonical source exists, its selected units govern pre-existing variants too.
    return source === type || !recordedTypes.has(source);
  });
  return [...new Set([
    ...DynamicDataLoader.getUnitBasedDataTypesFromDataTypes(convertible, settings, { includeDerivedTypes }),
    ...convertible.flatMap(type => DynamicDataLoader.getUnitBasedDataTypesFromDataType(type, settings) ?? [type]),
    ...types.filter(retainEventChartSourceValues),
  ])];
}

/** Unit conversion of recorded values is valid even when the sport cannot derive that metric. */
export function createMissingEventChartUnitStreams(
  recorded: StreamInterface[], allowedTypes: string[],
): StreamInterface[] {
  const existing = new Set(recorded.map(stream => stream.type));
  const allowed = new Set(allowedTypes);
  const result: StreamInterface[] = [];
  for (const stream of recorded) {
    if (retainEventChartSourceValues(stream.type) || !Object.prototype.hasOwnProperty.call(groups, stream.type)) continue;
    for (const [type, convert] of Object.entries(groups[stream.type])) {
      if (!allowed.has(type) || existing.has(type)) continue;
      result.push(new Stream(type, stream.getData().map(value =>
        typeof value === 'number' && Number.isFinite(value) ? convert(value) : null)));
      existing.add(type);
    }
  }
  return result;
}
