import { ActivityInterface, ActivityTypes, DataActiveLengths, DataDistance, DataDuration, DataHeartRateMax, EventImporterJSON, LapTypes } from '@sports-alliance/sports-lib';

/** Synthetic overlapping lap schemes, including a last set absent from automatic laps. */
export function createSwimIntervalFixture(): ActivityInterface {
  const lengths = [
    ['active', 'freestyle', 13], ['active', 'freestyle', 13], ['active', 'freestyle', 13], ['active', 'freestyle', 14],
    ['idle', null, 0], ['idle', null, 0], ['active', 'butterfly', 8], ['idle', null, 0],
    ['active', 'freestyle', 12], ['active', 'breaststroke', 16],
  ];
  return EventImporterJSON.getActivityFromJSON({
    name: null, startDate: 0, endDate: 300000, type: ActivityTypes.Swimming,
    powerMeter: false, trainer: false, creator: { name: 'Suunto synthetic', devices: [] },
    stats: { [DataActiveLengths.type]: 7, [DataDistance.type]: 175, [DataDuration.type]: 300, [DataHeartRateMax.type]: 180 },
    laps: [{ lapId: 1, type: LapTypes.FitnessEquipment, startDate: 0, endDate: 240000, startIndex: null, endIndex: null,
      stats: { [DataDistance.type]: 100, [DataDuration.type]: 120 } },
    { lapId: 2, type: LapTypes.Manual, startDate: 0, endDate: 300000, startIndex: null, endIndex: null,
      stats: { [DataDistance.type]: 175, [DataDuration.type]: 300 } }],
    streams: [], intensityZones: [], events: [],
    swimLengths: lengths.map(([type, stroke, strokes], index) => ({ index: index + 1, lapIndex: null,
      startDate: index * 30000, endDate: (index + 1) * 30000, type: type as string, stroke: stroke as string,
      strokes: strokes as number, elapsedTime: 30, timerTime: 30, distance: type === 'active' ? 25 : 0,
      poolLength: 25, avgSpeed: null, avgCadence: null, avgHeartRate: 120 + index, maxHeartRate: 130 + index,
      swolf: null, calories: null,
    })),
  });
}
