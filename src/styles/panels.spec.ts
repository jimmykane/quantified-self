import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shared panel elevation styles', () => {
  const panelStyles = readFileSync(resolve(process.cwd(), 'src/styles/_panels.scss'), 'utf8');
  const globalStyles = readFileSync(resolve(process.cwd(), 'src/styles.scss'), 'utf8');

  it('keeps glass panels and default Material cards flat', () => {
    expect(panelStyles).toContain('--qs-card-shadow: none;');
    expect(panelStyles).toContain('--qs-overlay-shadow:');
    expect(panelStyles).toMatch(/\.qs-glass-card-panel\s*\{[^}]*box-shadow:\s*var\(--qs-card-shadow\)/s);
    expect(panelStyles).toMatch(/--mat-card-elevated-container-elevation:\s*var\(--qs-card-shadow\)/);
    expect(panelStyles).toMatch(/--mat-card-filled-container-elevation:\s*var\(--qs-card-shadow\)/);
    expect(panelStyles).toMatch(/--mat-card-outlined-container-elevation:\s*var\(--qs-card-shadow\)/);
    expect(panelStyles).not.toContain('--qs-glass-panel-shadow');
  });

  it('reserves the stronger token for floating overlay surfaces', () => {
    for (const selector of [
      '.mat-bottom-sheet-container',
      '.mat-mdc-dialog-surface',
      '.mat-mdc-menu-panel.qs-menu-panel',
      '.mat-datepicker-content',
      '.mat-mdc-select-panel.qs-config-submenu',
    ]) {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(globalStyles).toMatch(
        new RegExp(`${escapedSelector}\\s*\\{[^}]*box-shadow:\\s*var\\(--qs-overlay-shadow\\)`, 's'),
      );
    }
  });

  it('keeps long menus inside the viewport with one scroll owner instead of clipping their controls', () => {
    const panel = globalStyles.match(/\.mat-mdc-menu-panel\.qs-menu-panel\s*\{([^}]+)\}/s)![1];
    const content = globalStyles.match(/\.mat-mdc-menu-panel\.qs-menu-panel \.mat-mdc-menu-content\s*\{([^}]+)\}/s)![1];
    expect(panel).toContain('max-height: calc(100dvh - 16px)');
    expect(panel).toContain('overflow-y: auto !important');
    expect(panel).toContain('overscroll-behavior-y: contain');
    expect(panel).not.toContain('overflow: hidden');
    expect(content).toContain('overflow: visible');
    expect(content).toContain('max-height: none');
  });
});
