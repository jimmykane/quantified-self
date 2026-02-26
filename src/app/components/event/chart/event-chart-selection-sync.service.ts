import { Injectable } from '@angular/core';
import { EventChartRange } from '../../../helpers/event-echarts-xaxis.helper';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable()
export class EventChartSelectionSyncService {
  private readonly selectionRangeSubject = new BehaviorSubject<EventChartRange | null>(null);

  public selectionRange(): EventChartRange | null {
    return this.selectionRangeSubject.getValue();
  }

  public selectionRangeChanges(): Observable<EventChartRange | null> {
    return this.selectionRangeSubject.asObservable();
  }

  public setSelection(range: EventChartRange | null): void {
    const normalizedRange = this.normalizeRange(range);
    if (this.areRangesEqual(this.selectionRange(), normalizedRange)) {
      return;
    }
    this.selectionRangeSubject.next(normalizedRange);
  }

  public clearSelection(): void {
    if (this.selectionRange() === null) {
      return;
    }
    this.selectionRangeSubject.next(null);
  }

  private normalizeRange(range: EventChartRange | null): EventChartRange | null {
    if (!range) {
      return null;
    }

    const start = Number(range.start);
    const end = Number(range.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }

    if (start <= end) {
      return { start, end };
    }
    return { start: end, end: start };
  }

  private areRangesEqual(left: EventChartRange | null, right: EventChartRange | null): boolean {
    if (!left || !right) {
      return !left && !right;
    }
    return Math.abs(left.start - right.start) < 0.0001 && Math.abs(left.end - right.end) < 0.0001;
  }
}
