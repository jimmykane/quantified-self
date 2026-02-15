import { MAT_MENU_DEFAULT_OPTIONS } from '@angular/material/menu';
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
});
