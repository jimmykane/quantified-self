import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RenderedThemeService } from './rendered-theme.service';

describe('RenderedThemeService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.classList.remove('dark-theme');
  });

  it('follows the applied light/dark CSS theme without account-data services', async () => {
    document.body.classList.add('dark-theme');
    const theme = TestBed.inject(RenderedThemeService);
    expect(theme.darkTheme()).toBe(true);
    document.body.classList.remove('dark-theme');
    await vi.waitFor(() => expect(theme.darkTheme()).toBe(false));
    document.body.classList.add('dark-theme');
    await vi.waitFor(() => expect(theme.darkTheme()).toBe(true));
    TestBed.resetTestingModule();
    document.body.classList.remove('dark-theme');
    await Promise.resolve();
    expect(theme.darkTheme()).toBe(true);
  });

  it('keeps an SSR-stable theme without a DOM observer', () => {
    const Observer = vi.fn();
    TestBed.configureTestingModule({ providers: [
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: DOCUMENT, useValue: { body: { classList: { contains: () => false } }, defaultView: { MutationObserver: Observer } } },
    ] });
    expect(TestBed.inject(RenderedThemeService).darkTheme()).toBe(false);
    expect(Observer).not.toHaveBeenCalled();
  });
});
