import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Compact row provider title alignment', () => {
  it('keeps centered prefixes as the default for unrelated rows', () => {
    const styles = readFileSync('src/app/components/shared/compact-row/compact-row.component.scss', 'utf8');
    expect(styles).toMatch(/\.compact-row__title\s*\{[^}]*align-items:\s*var\(--compact-row-title-align-items, center\)/);
  });

  it('uses one shared text baseline for every provider in overview and detail headings', () => {
    const styles = readFileSync('src/app/components/plans/training-delivery-dialog.component.scss', 'utf8');
    expect(styles).toMatch(/\.delivery-provider-row\s*\{\s*--compact-row-title-align-items:\s*baseline;\s*\}/);
  });
});
