import { ActivityTypes } from '@sports-alliance/sports-lib';

/** Independent expected Cloud catalog values, not generated from production mappings. */
export const WAHOO_SPORT_FIXTURES = [
  { sport: ActivityTypes.Running, family: 1, type: 1, location: 1, level: 'exact' },
  { sport: ActivityTypes.TrailRunning, family: 1, type: 4, location: 1, level: 'exact' },
  { sport: ActivityTypes.Treadmill, family: 1, type: 5, location: 0, level: 'exact' },
  { sport: ActivityTypes.IndoorRunning, family: 1, type: 5, location: 0, level: 'degraded' },
  { sport: ActivityTypes.VirtualRunning, family: 1, type: 71, location: 0, level: 'exact' },
  { sport: ActivityTypes.Cycling, family: 0, type: 0, location: 1, level: 'exact' },
  { sport: ActivityTypes.MountainBiking, family: 0, type: 13, location: 1, level: 'exact' },
  { sport: ActivityTypes.IndoorCycling, family: 0, type: 12, location: 0, level: 'exact' },
  { sport: ActivityTypes.VirtualCycling, family: 0, type: 68, location: 0, level: 'exact' },
  { sport: ActivityTypes.EBiking, family: 0, type: 64, location: 1, level: 'exact' },
  { sport: ActivityTypes.Handcycle, family: 0, type: 70, location: 1, level: 'exact' },
  { sport: ActivityTypes.Velomobile, family: 0, type: 0, location: 1, level: 'degraded' },
  { sport: ActivityTypes['Enduro MTB'], family: 0, type: 13, location: 1, level: 'degraded' },
  { sport: ActivityTypes.DownhillCycling, family: 0, type: 13, location: 1, level: 'degraded' },
  { sport: ActivityTypes.Walking, family: 9, type: 6, location: 1, level: 'exact' },
  { sport: ActivityTypes.Hiking, family: 9, type: 9, location: 1, level: 'exact' },
  { sport: ActivityTypes.Swimming, family: 2, type: 25, location: 0, level: 'degraded' },
  { sport: ActivityTypes.OpenWaterSwimming, family: 2, type: 26, location: 1, level: 'degraded' },
  { sport: ActivityTypes.Rowing, family: 3, type: 39, location: 1, level: 'degraded' },
  { sport: ActivityTypes.IndoorRowing, family: 6, type: 22, location: 0, level: 'degraded' },
] as const;
