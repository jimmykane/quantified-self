import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('event chart template contract', () => {
  it('passes contextual reset state to each data chart panel', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/components/event/chart/event.card.chart.component.html'),
      'utf8'
    );

    expect(template).toContain('[showResetChartState]="hasResettableChartState"');
    expect(template).toContain('(resetChartState)="onResetChartStateRequested()"');
  });
});
