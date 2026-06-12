import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SummaryPrimaryInfoComponent layout styles', () => {
  it('bounds projected metrics and actions so summary content can wrap instead of overflowing', () => {
    const summaryStyles = readFileSync(
      resolve(process.cwd(), 'src/app/components/shared/summary-primary-info/summary-primary-info.component.scss'),
      'utf8',
    );
    const metricsStyles = readFileSync(
      resolve(process.cwd(), 'src/app/components/shared/hero-metrics/hero-metrics.component.scss'),
      'utf8',
    );

    expect(summaryStyles).toContain('flex-wrap: wrap;');
    expect(summaryStyles).toContain('max-width: 100%;');
    expect(summaryStyles).toContain('flex: 1 1 360px;');
    expect(summaryStyles).toContain('@include bp.max-1024');
    expect(summaryStyles).toContain('.summary-primary-info .identity-section {\n    flex: 0 1 auto;');
    expect(metricsStyles).toContain('flex-wrap: wrap;');
    expect(metricsStyles).toContain('min-width: 0;');
    expect(metricsStyles).toContain('text-overflow: ellipsis;');
  });
});
