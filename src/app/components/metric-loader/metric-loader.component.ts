import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

type LoaderMetricKey = 'distance' | 'heartRate' | 'ascent' | 'descent';

interface LoaderDigitState {
  char: string;
  revision: number;
}

@Component({
  selector: 'app-metric-loader',
  templateUrl: './metric-loader.component.html',
  styleUrls: ['./metric-loader.component.scss'],
  standalone: false
})
export class MetricLoaderComponent implements OnInit, OnDestroy {
  public loaderDigits: Record<LoaderMetricKey, LoaderDigitState[]> = {
    distance: [],
    heartRate: [],
    ascent: [],
    descent: []
  };
  private loaderValues: Record<LoaderMetricKey, number> = {
    distance: 8.2,
    heartRate: 148,
    ascent: 160,
    descent: 154
  };
  private loaderDigitInterval: ReturnType<typeof setInterval> | null = null;
  private loaderFrame = 0;

  constructor(private changeDetectorRef: ChangeDetectorRef) {
    this.initializeLoaderMetrics();
  }

  ngOnInit(): void {
    this.startLoaderDigitLoop();
  }

  ngOnDestroy(): void {
    this.stopLoaderDigitLoop();
  }

  public loaderDigitTrack(metric: LoaderMetricKey, index: number, digit: LoaderDigitState): string {
    return `${metric}-${index}-${digit.revision}`;
  }

  private initializeLoaderMetrics(): void {
    const seed = Date.now();
    this.loaderValues.distance = 8 + ((seed % 13) / 10);
    this.loaderValues.heartRate = 140 + (seed % 42);
    this.loaderValues.ascent = 140 + (seed % 50);
    this.loaderValues.descent = 130 + (Math.trunc(seed / 7) % 60);

    this.loaderDigits.distance = this.buildLoaderDigits(this.formatDistance(this.loaderValues.distance));
    this.loaderDigits.heartRate = this.buildLoaderDigits(this.formatIntegerMetric(this.loaderValues.heartRate));
    this.loaderDigits.ascent = this.buildLoaderDigits(this.formatIntegerMetric(this.loaderValues.ascent));
    this.loaderDigits.descent = this.buildLoaderDigits(this.formatIntegerMetric(this.loaderValues.descent));
  }

  private startLoaderDigitLoop(): void {
    if (!this.shouldRunLoaderDigitLoop()) {
      return;
    }

    this.stopLoaderDigitLoop();
    this.loaderDigitInterval = setInterval(() => {
      if (this.advanceLoaderMetrics()) {
        this.changeDetectorRef.detectChanges();
      }
    }, 120);
  }

  private advanceLoaderMetrics(): boolean {
    this.loaderFrame += 1;
    let hasChanges = false;

    if (this.loaderFrame % 3 === 0) {
      this.loaderValues.distance = Math.min(99.9, Number((this.loaderValues.distance + 0.1).toFixed(1)));
      hasChanges = this.applyLoaderDigits('distance', this.formatDistance(this.loaderValues.distance)) || hasChanges;
    }

    if (this.loaderFrame % 2 === 0) {
      const oscillation = Math.sin(this.loaderFrame / 4);
      const pulse = Math.sin(this.loaderFrame / 9);
      this.loaderValues.heartRate = Math.max(130, Math.min(189, 154 + Math.round((oscillation * 10) + (pulse * 4))));
      hasChanges = this.applyLoaderDigits('heartRate', this.formatIntegerMetric(this.loaderValues.heartRate)) || hasChanges;
    }

    if (this.loaderFrame % 9 === 0) {
      this.loaderValues.ascent = Math.min(999, this.loaderValues.ascent + 1);
      hasChanges = this.applyLoaderDigits('ascent', this.formatIntegerMetric(this.loaderValues.ascent)) || hasChanges;
    }

    if (this.loaderFrame % 10 === 0) {
      this.loaderValues.descent = Math.min(999, this.loaderValues.descent + 1);
      hasChanges = this.applyLoaderDigits('descent', this.formatIntegerMetric(this.loaderValues.descent)) || hasChanges;
    }

    return hasChanges;
  }

  private stopLoaderDigitLoop(): void {
    if (this.loaderDigitInterval) {
      clearInterval(this.loaderDigitInterval);
      this.loaderDigitInterval = null;
    }
  }

  private shouldRunLoaderDigitLoop(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }
    return !navigator.userAgent.toLowerCase().includes('jsdom');
  }

  private buildLoaderDigits(value: string): LoaderDigitState[] {
    return value.split('').map(char => ({ char, revision: 0 }));
  }

  private applyLoaderDigits(metric: LoaderMetricKey, value: string): boolean {
    const nextChars = value.split('');
    const currentDigits = this.loaderDigits[metric];
    let hasChanges = currentDigits.length !== nextChars.length;

    const nextDigits = nextChars.map((char, index) => {
      const currentDigit = currentDigits[index];
      if (!currentDigit) {
        hasChanges = true;
        return { char, revision: 0 };
      }
      if (currentDigit.char === char) {
        return currentDigit;
      }

      hasChanges = true;
      return {
        char,
        revision: this.isNumericCharacter(char) ? currentDigit.revision + 1 : currentDigit.revision
      };
    });

    if (hasChanges) {
      this.loaderDigits[metric] = nextDigits;
    }

    return hasChanges;
  }

  private isNumericCharacter(value: string): boolean {
    return value >= '0' && value <= '9';
  }

  private formatDistance(value: number): string {
    return value.toFixed(1);
  }

  private formatIntegerMetric(value: number): string {
    return Math.round(value).toString().padStart(3, '0');
  }
}
