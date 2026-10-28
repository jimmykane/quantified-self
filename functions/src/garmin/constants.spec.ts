import { describe, expect, it } from 'vitest';
import { GARMIN_ALL_PERMISSIONS, GARMIN_REQUIRED_PERMISSIONS } from './constants';

describe('Garmin permission catalog', () => {
    it('lists supported permissions without the deferred MCT permission', () => {
        expect(GARMIN_ALL_PERMISSIONS).toEqual([
            'HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'WORKOUT_IMPORT', 'HEALTH_EXPORT', 'COURSE_IMPORT',
        ]);
        expect(GARMIN_REQUIRED_PERMISSIONS).toEqual([
            'HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT',
        ]);
    });
});
