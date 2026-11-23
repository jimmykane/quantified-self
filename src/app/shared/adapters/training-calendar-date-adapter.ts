import { DayjsDateAdapter } from './dayjs-date-adapter';
import type { AppUserService } from '../../services/app.user.service';

export class TrainingCalendarDateAdapter extends DayjsDateAdapter {
  constructor(locale: string, private readonly users: AppUserService) { super(locale); }
  override getFirstDayOfWeek(): number {
    const start = this.users.user()?.settings?.unitSettings?.startOfTheWeek;
    return Number.isInteger(start) && start >= 0 && start <= 6 ? start : 1;
  }
}
