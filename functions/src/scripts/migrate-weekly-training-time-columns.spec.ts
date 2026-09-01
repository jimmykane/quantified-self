import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDistance,
  DataDuration,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';

import {
  migrateWeeklyTrainingTimeTiles,
  parseWeeklyTrainingTimeColumnsMigrationOptions,
} from './migrate-weekly-training-time-columns';

function weeklyTrainingTimeTile(chartType: ChartTypes): Record<string, unknown> {
  return {
    type: TileTypes.Chart,
    chartType,
    dataType: DataDuration.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Weekly,
    name: 'Weekly Training Time',
    order: 7,
    size: { columns: 2, rows: 1 },
    eventFilters: { range: '1y', activityTypes: ['Running'] },
  };
}

describe('migrate-weekly-training-time-columns', () => {
  it('defaults to a dry run with bounded scan settings', () => {
    expect(parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=quantified-self-io',
    ])).toEqual({
      projectId: 'quantified-self-io',
      execute: false,
      confirmAllUsers: false,
      expectedTiles: undefined,
      uid: undefined,
      pageSize: 250,
      concurrency: 10,
    });
  });

  it('requires explicit global confirmation and a dry-run tile count before execution', () => {
    expect(() => parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=quantified-self-io',
      '--execute',
    ])).toThrow('requires --expected-tiles');
    expect(() => parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=quantified-self-io',
      '--execute',
      '--expected-tiles=4',
    ])).toThrow('requires --confirm-all-users');

    expect(parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=quantified-self-io',
      '--execute',
      '--confirm-all-users',
      '--expected-tiles=4',
      '--page-size=100',
      '--concurrency=5',
    ])).toMatchObject({
      execute: true,
      confirmAllUsers: true,
      expectedTiles: 4,
      pageSize: 100,
      concurrency: 5,
    });
  });

  it('allows a scoped execution without global confirmation', () => {
    expect(parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=quantified-self-io',
      '--uid=xcsAolLDDTWTgtRN9eYF3lW2YKL2',
      '--execute',
      '--expected-tiles=1',
    ])).toMatchObject({
      uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
      execute: true,
      confirmAllUsers: false,
      expectedTiles: 1,
    });
  });

  it('rejects unsafe or ambiguous arguments', () => {
    expect(() => parseWeeklyTrainingTimeColumnsMigrationOptions([]))
      .toThrow('--project must be an explicit Firebase project ID');
    expect(() => parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=-unsafe-project',
    ])).toThrow('--project must be an explicit Firebase project ID');
    expect(() => parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=quantified-self-io',
      '--uid=unsafe/user',
    ])).toThrow('--uid must be a safe Firebase UID');
    expect(() => parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=quantified-self-io',
      '--page-size=501',
    ])).toThrow('--page-size must be an integer between 1 and 500');
    expect(() => parseWeeklyTrainingTimeColumnsMigrationOptions([
      '--project=quantified-self-io',
      '--excute',
    ])).toThrow('Unknown migration argument: --excute');
  });

  it('changes only legacy vertical-line weekly training-time tiles', () => {
    const legacyTile = weeklyTrainingTimeTile(ChartTypes.LinesVertical);
    const existingColumnsTile = weeklyTrainingTimeTile(ChartTypes.ColumnsVertical);
    const distanceTile = {
      ...weeklyTrainingTimeTile(ChartTypes.LinesVertical),
      dataType: DataDistance.type,
    };

    const result = migrateWeeklyTrainingTimeTiles([
      legacyTile,
      existingColumnsTile,
      distanceTile,
    ]);

    expect(result.changed).toBe(true);
    expect(result.matchedTiles).toBe(1);
    expect(result.tiles?.[0]).toEqual({
      ...legacyTile,
      chartType: ChartTypes.ColumnsVertical,
    });
    expect(result.tiles?.[0]).toMatchObject({
      name: 'Weekly Training Time',
      order: 7,
      size: { columns: 2, rows: 1 },
      eventFilters: { range: '1y', activityTypes: ['Running'] },
    });
    expect(result.tiles?.[1]).toBe(existingColumnsTile);
    expect(result.tiles?.[2]).toBe(distanceTile);
    expect(legacyTile.chartType).toBe(ChartTypes.LinesVertical);
  });

  it('is idempotent for already migrated and malformed settings', () => {
    expect(migrateWeeklyTrainingTimeTiles([
      weeklyTrainingTimeTile(ChartTypes.ColumnsVertical),
    ])).toMatchObject({
      changed: false,
      matchedTiles: 0,
    });
    expect(migrateWeeklyTrainingTimeTiles(null)).toEqual({
      changed: false,
      matchedTiles: 0,
      tiles: null,
    });
  });
});
