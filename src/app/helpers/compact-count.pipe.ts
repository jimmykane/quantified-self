import { Inject, LOCALE_ID, Pipe, PipeTransform } from '@angular/core';

const COMPACT_COUNT_THRESHOLD = 10_000;

function normalizeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.floor(value));
}

export function formatCompactCount(value: unknown, locale?: string | null): string {
  const normalizedValue = normalizeCount(value);
  if (normalizedValue === null) {
    return '-';
  }

  const resolvedLocale = locale || undefined;
  if (normalizedValue < COMPACT_COUNT_THRESHOLD) {
    return new Intl.NumberFormat(resolvedLocale).format(normalizedValue);
  }

  return new Intl.NumberFormat(resolvedLocale, {
    compactDisplay: 'short',
    maximumFractionDigits: 2,
    notation: 'compact',
  }).format(normalizedValue);
}

@Pipe({
  name: 'compactCount',
  standalone: true,
})
export class CompactCountPipe implements PipeTransform {
  constructor(@Inject(LOCALE_ID) private locale: string) {}

  transform(value: unknown): string {
    return formatCompactCount(value, this.locale);
  }
}
