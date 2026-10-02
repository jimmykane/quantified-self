import { Injectable, effect, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { isTrainingPlansUrl } from '../helpers/training-plans-navigation.helper';
import { AppUserService } from './app.user.service';

export interface CalendarDayDetailsRestoration {
  sourceUrl: string;
  dateKey: string;
  surface?: 'today-sheet';
  deletedEventId?: string;
  calendarReturn?: import('../helpers/activity-calendar.helper').ActivityCalendarPeriodContext;
}

@Injectable({ providedIn: 'root' })
export class CalendarDayDetailsNavigationService {
  private readonly users = inject(AppUserService);
  private returnOwnerUid: string | null = null;
  private pendingReturn: CalendarDayDetailsRestoration | null = null;
  private readonly restoration = signal<CalendarDayDetailsRestoration | null>(null);
  private readonly destination = signal<{ ownerUid: string; dateKey: string; expiresAtMs: number } | null>(null);

  constructor(router: Router) {
    effect(() => {
      const uid = this.users.user()?.uid ?? null;
      if (this.returnOwnerUid && uid !== this.returnOwnerUid) {
        this.pendingReturn = null;
        this.restoration.set(null);
        this.returnOwnerUid = null;
      }
      const destination = this.destination();
      if (destination && this.users.user()?.uid !== destination.ownerUid) this.destination.set(null);
    });
    router.events.pipe(
      filter((event): event is NavigationStart | NavigationEnd => event instanceof NavigationStart || event instanceof NavigationEnd),
    ).subscribe(event => {
      if (event instanceof NavigationStart) this.handleNavigationStart(event);
      else this.handleNavigationEnd(event);
    });
  }

  prepareReturn(sourceUrl: string, dateKey: string, surface?: 'today-sheet', calendarReturn?: CalendarDayDetailsRestoration['calendarReturn']): boolean {
    const normalizedSourceUrl = normalizeLocalUrl(sourceUrl);
    const normalizedDateKey = normalizeDateKey(dateKey);
    if (!normalizedSourceUrl || !normalizedDateKey) {
      return false;
    }

    this.returnOwnerUid = this.users.user()?.uid ?? null;
    this.pendingReturn = {
      sourceUrl: normalizedSourceUrl,
      dateKey: normalizedDateKey,
      ...(surface ? { surface } : {}),
      ...(calendarReturn ? { calendarReturn } : {}),
    };
    this.restoration.set(null);
    return true;
  }

  prepareWorkoutDestination(ownerUid: string, dateKey: string): boolean {
    const normalizedDateKey = normalizeDateKey(dateKey);
    const normalizedUid = `${ownerUid || ''}`.trim();
    if (!normalizedUid || !normalizedDateKey) return false;
    this.destination.set({ ownerUid: normalizedUid, dateKey: normalizedDateKey, expiresAtMs: Date.now() + 60_000 });
    return true;
  }

  workoutDestinationFor(ownerUid: string): string | null {
    const destination = this.destination();
    if (!destination) return null;
    if (destination.ownerUid !== ownerUid || destination.expiresAtMs <= Date.now()) {
      this.destination.set(null);
      return null;
    }
    return destination.dateKey;
  }

  consumeWorkoutDestination(ownerUid: string, dateKey: string): boolean {
    if (this.workoutDestinationFor(ownerUid) !== dateKey) return false;
    this.destination.set(null);
    return true;
  }

  restorationFor(sourceUrl: string): CalendarDayDetailsRestoration | null {
    const normalizedSourceUrl = normalizeLocalUrl(sourceUrl);
    const restoration = this.restoration();
    return normalizedSourceUrl && restoration?.sourceUrl === normalizedSourceUrl
      ? restoration
      : null;
  }

  markEventDeleted(eventId: string): void {
    const normalizedEventId = `${eventId || ''}`.trim();
    if (!normalizedEventId || !this.pendingReturn) {
      return;
    }
    this.pendingReturn = {
      ...this.pendingReturn,
      deletedEventId: normalizedEventId,
    };
  }

  consumeRestoration(restoration: CalendarDayDetailsRestoration): boolean {
    const current = this.restoration();
    if (
      !current
      || current.sourceUrl !== restoration.sourceUrl
      || current.dateKey !== restoration.dateKey
      || current.surface !== restoration.surface
      || current.deletedEventId !== restoration.deletedEventId
    ) {
      return false;
    }

    this.restoration.set(null);
    return true;
  }

  private handleNavigationEnd(event: NavigationEnd): void {
    const pendingReturn = this.pendingReturn;
    if (!pendingReturn || normalizeLocalUrl(event.urlAfterRedirects) !== pendingReturn.sourceUrl) return;
    this.pendingReturn = null;
    if (this.returnOwnerUid && this.users.user()?.uid !== this.returnOwnerUid) {
      this.restoration.set(null);
      return;
    }
    // Calendar effects read router.url. Publish only after the destination URL and
    // its components are active, so a newly mounted tile cannot miss its return.
    this.restoration.set(pendingReturn);
  }

  private handleNavigationStart(event: NavigationStart): void {
    const pendingReturn = this.pendingReturn;
    if (!pendingReturn) {
      const restoration = this.restoration();
      if (restoration && normalizeLocalUrl(event.url) !== restoration.sourceUrl) {
        this.restoration.set(null);
      }
      return;
    }

    const targetUrl = normalizeLocalUrl(event.url);
    if (targetUrl === pendingReturn.sourceUrl) {
      return;
    }

    if (targetUrl && (isEventDetailsUrl(targetUrl) || isTrainingPlansUrl(targetUrl) || isCalendarDayUrl(targetUrl))) {
      return;
    }

    this.pendingReturn = null;
    this.restoration.set(null);
  }
}

function normalizeLocalUrl(value: unknown): string | null {
  const normalized = `${value || ''}`.trim();
  return normalized.startsWith('/') && !normalized.startsWith('//')
    ? normalized
    : null;
}

function normalizeDateKey(value: unknown): string | null {
  const normalized = `${value || ''}`.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day);
  return parsed.getFullYear() === year
    && parsed.getMonth() === monthIndex
    && parsed.getDate() === day
    ? normalized
    : null;
}

function isEventDetailsUrl(url: string): boolean {
  return /^\/user\/[^/?#]+\/event\/[^/?#]+(?:[?#]|$)/.test(url);
}

function isCalendarDayUrl(url: string): boolean {
  return /^\/calendar\/day\/\d{4}-\d{2}-\d{2}(?:[?#]|$)/.test(url);
}
