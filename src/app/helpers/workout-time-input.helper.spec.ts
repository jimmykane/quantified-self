import { describe, expect, it } from 'vitest';
import { formatWorkoutEditorPace, parseWorkoutEditorPace, splitWorkoutEditorMinutes, workoutDurationPartsToMinutes, workoutDurationPartsToSeconds } from './workout-time-input.helper';

describe('workout time entry', () => {
  it.each([60, 75, 90, 15, 3723, 90000, 0.5])('splits and recombines %s seconds', seconds => {
    const parts = splitWorkoutEditorMinutes(seconds / 60);
    expect(workoutDurationPartsToMinutes(parts) * 60).toBeCloseTo(seconds, 9);
  });
  it('splits a long duration into hours, minutes and seconds', () => {
    expect(splitWorkoutEditorMinutes(62.05)).toEqual({ hours: 1, minutes: 2, seconds: 3 });
    expect(splitWorkoutEditorMinutes(1.25)).toEqual({ hours: 0, minutes: 1, seconds: 15 });
  });
  it('retains exact authored seconds, including values that cannot round-trip through minutes', () => {
    for (let seconds = 1; seconds <= 600; seconds++) {
      expect(workoutDurationPartsToSeconds({ hours: 0, minutes: Math.floor(seconds / 60), seconds: seconds % 60 }))
        .toBe(seconds);
    }
    expect(workoutDurationPartsToSeconds({ hours: 0, minutes: 0, seconds: 0.123456789012345 }))
      .toBe(0.123456789012345);
  });
  it.each([
    { hours: 0, minutes: 0, seconds: 0 }, { hours: -1, minutes: 1, seconds: 0 },
    { hours: 0.5, minutes: 1, seconds: 0 }, { hours: 0, minutes: 60, seconds: 0 },
    { hours: 0, minutes: 1, seconds: 60 }, { hours: 0, minutes: null, seconds: 1 },
    { hours: Infinity, minutes: 1, seconds: 0 }, { hours: 0, minutes: 1, seconds: NaN },
  ])('rejects invalid duration parts %j', parts => {
    expect(workoutDurationPartsToMinutes(parts)).toBeNaN();
  });
  it.each([['4:30', 4.5], ['1:15', 1.25], ['1:30', 1.5], ['0:15', 0.25],
    ['4.5', 4.5], ['4,5', 4.5], ['.5', 0.5], [',5', 0.5], ['4.', 4], ['+4.5', 4.5],
    ['1:02:03', 62.05], ['4:30.5', 270.5 / 60]])(
    'parses %s as %s minutes', (text, expected) => expect(parseWorkoutEditorPace(text)).toBeCloseTo(expected, 9),
  );
  it.each(['4:60', '4:', '-4:30', '0:00', '1:60:00', 'Infinity', '4:30oops', 'NaN', '.', '+', '-.5'])('rejects %s', text => {
    expect(parseWorkoutEditorPace(text)).toBeNaN();
  });
  it('uses Sports Lib stopwatch formatting for editable pace', () => {
    expect(formatWorkoutEditorPace(4.5)).toBe('4:30');
    expect(formatWorkoutEditorPace(62.05)).toBe('1:02:03');
    expect(formatWorkoutEditorPace(270.5 / 60)).toBe('4:30.5');
    expect(parseWorkoutEditorPace(formatWorkoutEditorPace(1e-9))).toBe(1e-9);
    expect(parseWorkoutEditorPace('')).toBeNull();
  });
});
