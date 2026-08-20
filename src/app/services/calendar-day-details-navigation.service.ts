import { Injectable, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

export interface CalendarDayDetailsRestoration {
  sourceUrl: string;
  dateKey: string;
  deletedEventId?: string;
}

@Injectable({ providedIn: 'root' })
export class CalendarDayDetailsNavigationService {
  private pendingReturn: CalendarDayDetailsRestoration | null = null;
  private readonly restoration = signal<CalendarDayDetailsRestoration | null>(null);

  constructor(router: Router) {
    router.events.pipe(
      filter((event): event is NavigationStart => event instanceof NavigationStart),
    ).subscribe(event => this.handleNavigationStart(event));
  }

  prepareReturn(sourceUrl: string, dateKey: string): boolean {
    const normalizedSourceUrl = normalizeLocalUrl(sourceUrl);
    const normalizedDateKey = normalizeDateKey(dateKey);
    if (!normalizedSourceUrl || !normalizedDateKey) {
      return false;
    }

    this.pendingReturn = {
      sourceUrl: normalizedSourceUrl,
      dateKey: normalizedDateKey,
    };
    this.restoration.set(null);
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
      || current.deletedEventId !== restoration.deletedEventId
    ) {
      return false;
    }

    this.restoration.set(null);
    return true;
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
    if (event.navigationTrigger === 'popstate' && targetUrl === pendingReturn.sourceUrl) {
      this.pendingReturn = null;
      this.restoration.set(pendingReturn);
      return;
    }

    if (targetUrl && isEventDetailsUrl(targetUrl)) {
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
