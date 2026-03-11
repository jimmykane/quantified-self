import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ActivityTypeGroups, ActivityTypes } from '@sports-alliance/sports-lib';
import { AppEventColorService } from './app.event.color.service';
import { LoggerService } from '../logger.service';
import { AppColors } from './app.colors';
import { AppDeviceColors } from './app.device.colors';
import { AppActivityTypeGroupColors } from './app.activity-type-group.colors';

describe('AppEventColorService', () => {
  let service: AppEventColorService;
  let mockLoggerService: { warn: ReturnType<typeof vi.fn>, log: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockLoggerService = {
      warn: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AppEventColorService,
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    });

    service = TestBed.inject(AppEventColorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getDifferenceColor', () => {
    it('should return Green for percent <= 2', () => {
      expect(service.getDifferenceColor(0)).toBe(AppColors.Green);
      expect(service.getDifferenceColor(2)).toBe(AppColors.Green);
    });

    it('should return Orange for percent > 2 and <= 5', () => {
      expect(service.getDifferenceColor(2.1)).toBe(AppColors.Orange);
      expect(service.getDifferenceColor(5)).toBe(AppColors.Orange);
    });

    it('should return Red for percent > 5', () => {
      expect(service.getDifferenceColor(5.1)).toBe(AppColors.Red);
    });
  });

  describe('getColorByNumber', () => {
    it('should return a hex-like color string', () => {
      expect(service.getColorByNumber(123)).toMatch(/^#[0-9a-fA-F]+$/);
    });

    it('should be deterministic', () => {
      expect(service.getColorByNumber(10)).toBe(service.getColorByNumber(10));
      expect(service.getColorByNumber(10)).not.toBe(service.getColorByNumber(11));
    });
  });

  describe('getActivityColor', () => {
    beforeEach(() => {
      service.clearCache();
    });

    it('should return the same color for the same activity (cache hit)', () => {
      const activities: any[] = [
        { getID: () => '1', creator: { name: 'Player 1' } },
      ];

      const color1 = service.getActivityColor(activities as any, activities[0] as any);
      const color2 = service.getActivityColor(activities as any, activities[0] as any);

      expect(color1).toBe(color2);
    });

    it('should assign distinct colors to two activities with duplicate IDs', () => {
      const activities: any[] = [
        { getID: () => 'dup', creator: { name: 'Player 1' } },
        { getID: () => 'dup', creator: { name: 'Player 2' } },
      ];

      const color1 = service.getActivityColor(activities as any, activities[0] as any);
      const color2 = service.getActivityColor(activities as any, activities[1] as any);

      expect(color1).not.toBe(color2);
    });

    it('should assign distinct colors to two activities with missing IDs', () => {
      const activities: any[] = [
        { getID: () => undefined, creator: { name: 'Player 1' } },
        { getID: () => undefined, creator: { name: 'Player 2' } },
      ];

      const color1 = service.getActivityColor(activities as any, activities[0] as any);
      const color2 = service.getActivityColor(activities as any, activities[1] as any);

      expect(color1).not.toBe(color2);
    });

    it('should return known color for first known-device activity and generated color for subsequent ones', () => {
      const activities: any[] = [
        { getID: () => '1', creator: { name: 'Suunto 0' } },
        { getID: () => '2', creator: { name: 'Suunto 0' } },
      ];

      const firstColor = service.getActivityColor(activities as any, activities[0] as any);
      const secondColor = service.getActivityColor(activities as any, activities[1] as any);

      expect(firstColor).toBe(AppDeviceColors['Suunto 0']);
      expect(secondColor).not.toBe(firstColor);
    });

    it('should handle activity not found in array gracefully and log warning', () => {
      const activities: any[] = [
        { getID: () => '1', creator: { name: 'Player 1' } },
      ];
      const activityNotInArray: any = { getID: () => '99', creator: { name: 'Ghost' } };

      const color = service.getActivityColor(activities as any, activityNotInArray as any);

      expect(mockLoggerService.warn).toHaveBeenCalledWith(expect.stringContaining('Activity not found'));
      expect(color).toMatch(/^#[0-9a-fA-F]+$/);
    });
  });

  describe('getColorForZone', () => {
    it('should return zone color hex', () => {
      const result = service.getColorForZone('Zone 5');
      expect(result).toBe(AppColors.LightestRed);
    });
  });

  describe('getGradientForActivityTypeGroup', () => {
    it('should return a valid linear-gradient string', () => {
      const gradient = service.getGradientForActivityTypeGroup(ActivityTypes.Running);
      expect(gradient).toContain('linear-gradient');
    });

    it('should return mountain-biking gradient for MTB related activities', () => {
      const mountainGradient = service.getGradientForActivityTypeGroup(ActivityTypes.MountainBiking);
      const enduroGradient = service.getGradientForActivityTypeGroup(ActivityTypes['Enduro MTB']);
      const downhillGradient = service.getGradientForActivityTypeGroup(ActivityTypes.DownhillCycling);

      expect(mountainGradient).toBe(enduroGradient);
      expect(mountainGradient).toBe(downhillGradient);
      expect(mountainGradient).toContain('#FF9800');
      expect(mountainGradient).toContain('#43A047');
    });
  });

  describe('getColorForActivityTypeByActivityTypeGroup', () => {
    it('should use mountain-biking color for MTB related activities', () => {
      const expectedMountainBikingColor = AppActivityTypeGroupColors[ActivityTypeGroups.MountainBiking];

      expect(service.getColorForActivityTypeByActivityTypeGroup(ActivityTypes.MountainBiking)).toBe(expectedMountainBikingColor);
      expect(service.getColorForActivityTypeByActivityTypeGroup(ActivityTypes['Enduro MTB'])).toBe(expectedMountainBikingColor);
      expect(service.getColorForActivityTypeByActivityTypeGroup(ActivityTypes.DownhillCycling)).toBe(expectedMountainBikingColor);
      expect(service.getColorForActivityTypeByActivityTypeGroup(ActivityTypes.Cycling)).not.toBe(expectedMountainBikingColor);
    });
  });
});
