import { FullscreenOverlayContainer, OverlayContainer } from '@angular/cdk/overlay';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { MAT_MENU_DEFAULT_OPTIONS } from '@angular/material/menu';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppModule, QS_MENU_DEFAULT_OPTIONS } from './app.module';

describe('AppModule menu defaults', () => {
  it('exports the expected default menu options', () => {
    expect(QS_MENU_DEFAULT_OPTIONS).toEqual({
      overlayPanelClass: 'qs-menu-panel',
      hasBackdrop: true,
      overlapTrigger: false,
      xPosition: 'after',
      yPosition: 'below',
      backdropClass: 'cdk-overlay-transparent-backdrop'
    });
  });

  it('registers MAT_MENU_DEFAULT_OPTIONS in AppModule providers', () => {
    const providers = ((AppModule as any).ɵinj?.providers ?? []) as Array<any>;
    const menuProvider = providers.find((provider) => provider?.provide === MAT_MENU_DEFAULT_OPTIONS);

    expect(menuProvider).toBeTruthy();
    expect(menuProvider.useValue).toEqual(QS_MENU_DEFAULT_OPTIONS);
  });

  it('registers the fullscreen-aware overlay container in AppModule providers', () => {
    const providers = ((AppModule as any).ɵinj?.providers ?? []) as Array<any>;
    const overlayProvider = providers.find((provider) => provider?.provide === OverlayContainer);

    expect(overlayProvider).toBeTruthy();
    expect(overlayProvider.useClass).toBe(FullscreenOverlayContainer);
  });

  it('does not install a global dialog panel class that overrides Material dialog motion', () => {
    const providers = ((AppModule as any).ɵinj?.providers ?? []) as Array<any>;
    const dialogProvider = providers.find((provider) => provider?.provide === MAT_DIALOG_DEFAULT_OPTIONS);
    const stylesPath = resolve(process.cwd(), 'src/styles.scss');
    const styles = readFileSync(stylesPath, 'utf8');

    expect(dialogProvider).toBeFalsy();
    expect(styles).not.toContain('qs-dialog-container');
  });

  it('routes Material overlay surfaces through the shared app overlay token', () => {
    const stylesPath = resolve(process.cwd(), 'src/styles.scss');
    const styles = readFileSync(stylesPath, 'utf8');

    expect(styles).toContain('--qs-overlay-surface:');
    expect(styles).toContain('--mat-autocomplete-background-color: var(--qs-overlay-surface);');
    expect(styles).toContain('--mat-bottom-sheet-container-background-color: var(--qs-overlay-surface);');
    expect(styles).toContain('--mat-datepicker-calendar-container-background-color: var(--qs-overlay-surface);');
    expect(styles).toContain('--mat-dialog-container-color: var(--qs-overlay-surface);');
    expect(styles).toContain('--mat-menu-container-color: var(--qs-overlay-surface);');
    expect(styles).toContain('--mat-select-panel-background-color: var(--qs-overlay-surface);');
    expect(styles).toContain('--qs-overlay-section-bg: var(--mat-sys-surface-container-high);');
    expect(styles).toContain('--qs-overlay-section-border: var(--mat-sys-outline-variant);');
  });

  it('keeps the dark theme page background off the CDK overlay container', () => {
    const stylesPath = resolve(process.cwd(), 'src/styles.scss');
    const styles = readFileSync(stylesPath, 'utf8');

    expect(styles).toMatch(/body\.dark-theme\s*{[^}]*background-color:\s*var\(--mat-sys-background\);/s);
    expect(styles).toMatch(/\.cdk-overlay-container\.dark-theme\s*{[^}]*background-color:\s*transparent;/s);
    const topLevelDarkThemeBlocks = Array.from(
      styles.matchAll(/(?:^|\n)\.dark-theme\s*{([^}]*)}/g),
      (match) => match[1]
    );

    expect(topLevelDarkThemeBlocks).not.toHaveLength(0);
    expect(topLevelDarkThemeBlocks.some((block) => /(?:^|\n)\s*background-color\s*:/.test(block))).toBe(false);
  });
});
