import { describe, it, expect } from 'vitest';
import { AppUserUtilities } from './app.user.utilities';
import { User, ActivityTypes, DateRanges, AppThemes, ChartThemes } from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';

describe('AppUserUtilities', () => {
    const mockUser = { uid: 'u1', settings: {} } as any;

    describe('isGracePeriodActive', () => {
        it('should return false for null user', () => {
            expect(AppUserUtilities.isGracePeriodActive(null)).toBe(false);
        });

        it('should return true for future date (Timestamp)', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const user = { ...mockUser, gracePeriodUntil: { toMillis: () => futureDate.getTime() } };
            expect(AppUserUtilities.isGracePeriodActive(user)).toBe(true);
        });

        it('should return true for future date (Date)', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const user = { ...mockUser, gracePeriodUntil: futureDate };
            expect(AppUserUtilities.isGracePeriodActive(user)).toBe(true);
        });

        it('should return true for future date (seconds)', () => {
            const futureSeconds = (Date.now() / 1000) + 1000;
            const user = { ...mockUser, gracePeriodUntil: { seconds: futureSeconds } };
            expect(AppUserUtilities.isGracePeriodActive(user)).toBe(true);
        });

        it('should return false for past date', () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 1);
            const user = { ...mockUser, gracePeriodUntil: pastDate };
            expect(AppUserUtilities.isGracePeriodActive(user)).toBe(false);
        });
    });

    describe('hasProAccess', () => {
        it('should return true if isProUser is true', () => {
            const user = { ...mockUser, stripeRole: 'pro' };
            expect(AppUserUtilities.hasProAccess(user)).toBe(true);
        });

        it('should return true if in active grace period', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const user = { ...mockUser, stripeRole: 'free', gracePeriodUntil: futureDate };
            expect(AppUserUtilities.hasProAccess(user)).toBe(true);
        });

        it('should return false for free user with no grace period', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.hasProAccess(user)).toBe(false);
        });
    });

    describe('isProUser', () => {
        it('should return false for null user', () => {
            expect(AppUserUtilities.isProUser(null)).toBe(false);
        });

        it('should return true if stripeRole is pro', () => {
            const user = { ...mockUser, stripeRole: 'pro' };
            expect(AppUserUtilities.isProUser(user)).toBe(true);
        });

        it('should return true if isAdmin is true', () => {
            const user = { ...mockUser, stripeRole: 'basic' };
            expect(AppUserUtilities.isProUser(user, true)).toBe(true);
        });

        it('should return true if user.isPro is true', () => {
            const user = { ...mockUser, isPro: true };
            expect(AppUserUtilities.isProUser(user)).toBe(true);
        });

        it('should return false for basic user without admin/isPro', () => {
            const user = { ...mockUser, stripeRole: 'basic' };
            expect(AppUserUtilities.isProUser(user)).toBe(false);
        });

        it('should return false for free user', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.isProUser(user)).toBe(false);
        });
    });

    describe('isBasicUser', () => {
        it('should return false for null user', () => {
            expect(AppUserUtilities.isBasicUser(null)).toBe(false);
        });

        it('should return true if stripeRole is basic', () => {
            const user = { ...mockUser, stripeRole: 'basic' };
            expect(AppUserUtilities.isBasicUser(user)).toBe(true);
        });

        it('should return false if stripeRole is pro', () => {
            const user = { ...mockUser, stripeRole: 'pro' };
            expect(AppUserUtilities.isBasicUser(user)).toBe(false);
        });

        it('should return false if stripeRole is free', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.isBasicUser(user)).toBe(false);
        });
    });

    describe('hasPaidAccessUser', () => {
        it('should return false for null user', () => {
            expect(AppUserUtilities.hasPaidAccessUser(null)).toBe(false);
        });

        it('should return true for basic user', () => {
            const user = { ...mockUser, stripeRole: 'basic' };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(true);
        });

        it('should return true for pro user', () => {
            const user = { ...mockUser, stripeRole: 'pro' };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(true);
        });

        it('should return true if isAdmin is true', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.hasPaidAccessUser(user, true)).toBe(true);
        });

        it('should return true if user.isPro is true', () => {
            const user = { ...mockUser, isPro: true };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(true);
        });

        it('should return true if user is in grace period', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const user = { ...mockUser, stripeRole: 'free', gracePeriodUntil: futureDate };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(true);
        });

        it('should return false for free user', () => {
            const user = { ...mockUser, stripeRole: 'free' };
            expect(AppUserUtilities.hasPaidAccessUser(user)).toBe(false);
        });
    });

    describe('fillMissingAppSettings', () => {
        it('should fill defaults for empty settings', () => {
            const user = { settings: {} } as User;
            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.appSettings?.theme).toBe(AppThemes.Normal);
            expect(settings.chartSettings?.theme).toBe(ChartThemes.Material);
            expect(settings.dashboardSettings?.dateRange).toBe(DateRanges.all);
            expect(settings.dashboardSettings?.includeMergedEvents).toBe(true);
            expect(settings.unitSettings?.startOfTheWeek).toBe(1); // Monday
            expect((settings.myTracksSettings as any)?.showJumpHeatmap).toBe(true);
        });

        it('should preserve existing settings', () => {
            const user = {
                settings: {
                    appSettings: { theme: AppThemes.Dark },
                    dashboardSettings: { dateRange: DateRanges.lastYear, includeMergedEvents: false }
                }
            } as User;
            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect(settings.appSettings?.theme).toBe(AppThemes.Dark);
            expect(settings.dashboardSettings?.dateRange).toBe(DateRanges.lastYear);
            expect(settings.dashboardSettings?.includeMergedEvents).toBe(false);
        });

        it('should preserve explicit showJumpHeatmap=false', () => {
            const user = {
                settings: {
                    myTracksSettings: {
                        showJumpHeatmap: false
                    }
                }
            } as any;

            const settings = AppUserUtilities.fillMissingAppSettings(user);
            expect((settings.myTracksSettings as any)?.showJumpHeatmap).toBe(false);
        });
    });
});
