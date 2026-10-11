import { DataDistance, DataDuration, DistanceUnits } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings, resolveUnitAwareDisplayStat } from '../../shared/unit-aware-display';

// Synthetic design data only; no account data or production reads.
export const activities = [
  { id: 'a1', name: 'Sunday long run', date: '2026-10-11', time: '08:15', sport: 'Running', distance: 18420, duration: 5708, tags: ['Endurance', 'Outdoors'] },
  { id: 'a2', name: 'Coastal endurance ride', date: '2026-10-10', time: '09:30', sport: 'Cycling', distance: 64200, duration: 8362, tags: ['Endurance', 'Outdoors'] },
  { id: 'a3', name: 'Easy pool session', date: '2026-10-09', time: '07:10', sport: 'Swimming', distance: 1800, duration: 2436, tags: ['Recovery'] },
  { id: 'a4', name: 'Aerobic evening run', date: '2026-10-08', time: '18:25', sport: 'Running', distance: 10250, duration: 3162, tags: ['Endurance', 'Commute'] },
  { id: 'a5', name: 'Six hill repeats', date: '2026-10-07', time: '17:45', sport: 'Running', distance: 8640, duration: 2794, tags: ['Intervals', 'Outdoors'] },
  { id: 'a6', name: 'Recovery spin', date: '2026-10-06', time: '16:30', sport: 'Cycling', distance: 22100, duration: 3006, tags: ['Recovery', 'Indoor'] },
  { id: 'a7', name: 'Forest loop', date: '2026-10-05', time: '08:40', sport: 'Trail Running', distance: 14350, duration: 5035, tags: ['Endurance', 'Outdoors'] },
  { id: 'a8', name: 'Ride to work', date: '2026-10-04', time: '08:00', sport: 'Cycling', distance: 9700, duration: 1871, tags: ['Commute'] },
  { id: 'a9', name: 'Steady indoor ride', date: '2026-10-03', time: '10:20', sport: 'Cycling', distance: 36800, duration: 4215, tags: ['Endurance', 'Indoor'] },
  { id: 'a10', name: 'Evening walk', date: '2026-10-02', time: '19:15', sport: 'Walking', distance: 4260, duration: 3020, tags: [] },
  { id: 'a11', name: 'Track session', date: '2026-09-30', time: '18:00', sport: 'Running', distance: 7900, duration: 2674, tags: ['Intervals'] },
  { id: 'a12', name: 'Long easy ride', date: '2026-09-27', time: '09:00', sport: 'Cycling', distance: 78100, duration: 9805, tags: ['Endurance', 'Outdoors'] },
];

export const savedTags = ['Commute', 'Endurance', 'Indoor', 'Intervals', 'Outdoors', 'Race day', 'Recovery'];

export function buildDisplayFixtures() {
  const metric = getDefaultUserUnitSettings();
  const imperial = { ...metric, distanceUnits: DistanceUnits.Miles };
  return activities.map(activity => ({
    ...activity,
    display: Object.fromEntries(Object.entries({ Metric: metric, Imperial: imperial }).map(([name, settings]) => [name, {
      distance: resolveUnitAwareDisplayStat(new DataDistance(activity.distance), settings),
      duration: resolveUnitAwareDisplayStat(new DataDuration(activity.duration), settings),
    }])),
  }));
}
