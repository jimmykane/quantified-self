import { DateRanges } from '@sports-alliance/sports-lib';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib';

export interface DateRangeStartDateAndEndDate {
  startDate: Date;
  endDate: Date;
}

export function getDatesForDateRange(dateRange: DateRanges, startOfTheWeek: DaysOfTheWeek): DateRangeStartDateAndEndDate {
  const daysBack = new Date().getDay() >= startOfTheWeek ? 0 : 7;
  const firstDayOfTheWeek = (new Date().getDate() - new Date().getDay()) + startOfTheWeek; // Remove + 1 if sunday is first day of the week.
  const lastDayOfTheWeek = firstDayOfTheWeek + 6;

  // First day of this week

  const fistDayOfTheWeekDate = new Date(new Date().setDate(firstDayOfTheWeek - daysBack));
  fistDayOfTheWeekDate.setHours(0, 0, 0);


  // Last day if this week
  const lastDayOfTheWeekDate = new Date(new Date().setDate(lastDayOfTheWeek - daysBack));
  lastDayOfTheWeekDate.setHours(23, 59, 59);

  // Take the first day of this week and go back 7 days
  const firstDayOfLastWeekDate = new Date(new Date(fistDayOfTheWeekDate).setDate(fistDayOfTheWeekDate.getDate() - 7)); // Needs to base on fistDayOfTheWeekDate for new Date()
  firstDayOfLastWeekDate.setHours(0, 0, 0);

  // Take the first day of this week and go back 1second
  const lastDayOfLastWeekDate = new Date(new Date(fistDayOfTheWeekDate.getTime()).setHours(0, 0, -1));

  switch (dateRange) {
    case DateRanges.thisWeek: {
      return {
        startDate: fistDayOfTheWeekDate,
        endDate: lastDayOfTheWeekDate
      };
    }
    case DateRanges.lastWeek: {
      return {
        startDate: firstDayOfLastWeekDate,
        endDate: lastDayOfLastWeekDate,
      }
    }
    case DateRanges.lastSevenDays: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 6),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      }
    }
    case DateRanges.lastThirtyDays: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 29),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      }
    }
    case DateRanges.thisMonth: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      }
    }
    case DateRanges.lastMonth: {
      return {
        startDate: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
        endDate: new Date(new Date(new Date().getFullYear(), new Date().getMonth(), 0).setHours(23, 59, 59))
      }
    }
    case DateRanges.thisYear: {
      return {
        startDate: new Date(new Date().getFullYear(), 0, 1),
        endDate: new Date(new Date().setHours(24, 0, 0, 0))
      }
    }
    case DateRanges.lastYear: {
      return {
        startDate: new Date(new Date().getFullYear() - 1, 0, 1),
        endDate: new Date(new Date(new Date().getFullYear(), 0, 0).setHours(23, 59, 59))
      }
    }
    default: {
      return {
        startDate: null,
        endDate: null
      }
    }
  }
}
