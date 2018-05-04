/**
 * This enum works like a all matchers for normalized lap types between different naming across services
 */
export enum LapTypes {
  'Start' = 'Start',
  'Stop' = 'Start',
  'Manual' = 'Manual',
  'manual' = 'Manual',
  'Autolap' = 'Auto lap',
  'AutoLap' = 'Auto lap',
  'autolap' = 'Auto lap',
  'Distance' = 'Distance',
  'distance' = 'Distance',
  'Location' = 'Location',
  'location' = 'Location',
  'Time' = 'Time',
  'time' = 'Time',
  'HeartRate' = 'Heart Rate',
  'position_start' = 'Position start',
  'position_lap' = 'Position lap',
  'position_waypoint' = 'Position waypoint',
  'position_marked' = 'Position marked',
  'session_end' = 'Session end',
  'fitness_equipment' = 'Fitness equipment',
}
