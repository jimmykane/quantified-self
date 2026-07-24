import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DeleteAccountDialogComponent styles', () => {
  it('keeps the dialog within narrow viewports and lets destructive actions wrap', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/delete-account-dialog/delete-account-dialog.component.scss'),
      'utf8'
    );
    const contentRule = styles.match(/mat-dialog-content\s*\{[^}]*\}/)?.[0] ?? '';
    const actionsRule = styles.match(/mat-dialog-actions\s*\{[^}]*\}/)?.[0] ?? '';

    expect(contentRule).toContain('min-width: min(100%, 380px)');
    expect(actionsRule).toContain('flex-wrap: wrap');
    expect(styles).toContain('@include bp.max-480');
    expect(styles).toContain('flex: 1 1 136px');
  });
});
