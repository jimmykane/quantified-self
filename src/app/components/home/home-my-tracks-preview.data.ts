import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { TracksMapPreparedTrack } from '../tracks/tracks-map.manager';

type PreviewCoordinate = [longitude: number, latitude: number];

function previewTrack(
  id: string,
  type: ActivityTypes,
  coordinates: PreviewCoordinate[],
): TracksMapPreparedTrack {
  return {
    activity: {
      getID: () => id,
      type,
    },
    coordinates,
  };
}

/** Deterministic, account-independent GPS traces used only by the public homepage. */
export const HOME_MY_TRACKS_PREVIEW_TRACKS: readonly TracksMapPreparedTrack[] = Object.freeze([
  previewTrack('sample-run-river', ActivityTypes.Running, [
    [11.3792, 47.2692], [11.3821, 47.2711], [11.3864, 47.2724], [11.3912, 47.2728],
    [11.3958, 47.2719], [11.3986, 47.2697], [11.3961, 47.2678], [11.3915, 47.2671],
    [11.3867, 47.2676], [11.3823, 47.2684], [11.3792, 47.2692],
  ]),
  previewTrack('sample-ride-west', ActivityTypes.Cycling, [
    [11.3904, 47.2681], [11.3780, 47.2664], [11.3652, 47.2650], [11.3510, 47.2644],
    [11.3365, 47.2661], [11.3218, 47.2700], [11.3074, 47.2736], [11.2930, 47.2782],
    [11.2788, 47.2814], [11.2643, 47.2830],
  ]),
  previewTrack('sample-ride-east', ActivityTypes.Cycling, [
    [11.3910, 47.2700], [11.4047, 47.2718], [11.4188, 47.2747], [11.4330, 47.2762],
    [11.4481, 47.2754], [11.4626, 47.2721], [11.4770, 47.2685], [11.4918, 47.2667],
    [11.5060, 47.2680], [11.5204, 47.2719],
  ]),
  previewTrack('sample-hike-north', ActivityTypes.Hiking, [
    [11.3897, 47.2750], [11.3862, 47.2820], [11.3830, 47.2891], [11.3791, 47.2960],
    [11.3754, 47.3030], [11.3708, 47.3101], [11.3660, 47.3170], [11.3612, 47.3238],
    [11.3561, 47.3299],
  ]),
  previewTrack('sample-trail-south', ActivityTypes.TrailRunning, [
    [11.3978, 47.2663], [11.4004, 47.2590], [11.4038, 47.2516], [11.4094, 47.2451],
    [11.4170, 47.2398], [11.4262, 47.2365], [11.4370, 47.2344], [11.4477, 47.2356],
    [11.4554, 47.2401],
  ]),
  previewTrack('sample-mtb-loop', ActivityTypes.MountainBiking, [
    [11.3710, 47.2810], [11.3612, 47.2861], [11.3517, 47.2927], [11.3461, 47.3000],
    [11.3490, 47.3072], [11.3582, 47.3111], [11.3688, 47.3084], [11.3744, 47.3010],
    [11.3770, 47.2927], [11.3710, 47.2810],
  ]),
]);

export const HOME_MY_TRACKS_PREVIEW_COORDINATES: number[][] = HOME_MY_TRACKS_PREVIEW_TRACKS
  .flatMap((track) => track.coordinates);
