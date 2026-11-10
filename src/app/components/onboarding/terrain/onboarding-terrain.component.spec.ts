import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import {
  ONBOARDING_TERRAIN_LOADER,
  OnboardingTerrainComponent
} from './onboarding-terrain.component';
import type { TerrainOptions } from './onboarding-terrain.types';

describe('OnboardingTerrainComponent', () => {
  const theme = signal(AppThemes.Normal);
  const controller = {
    setTheme: vi.fn(),
    setMotion: vi.fn(),
    dispose: vi.fn()
  };
  const selection = vi.fn();
  let options: TerrainOptions;
  let change: (event: MediaQueryListEvent) => void;
  const removeListener = vi.fn();
  const createTerrainRenderer = vi.fn(
    (_canvas, _stage, value: TerrainOptions) => {
      options = value;
      return controller;
    }
  );
  const loader = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    theme.set(AppThemes.Normal);
    loader.mockResolvedValue({ createTerrainRenderer });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (_name: string, callback: typeof change) => {
          change = callback;
        },
        removeEventListener: removeListener
      }))
    );
    TestBed.configureTestingModule({
      imports: [OnboardingTerrainComponent],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: theme } },
        { provide: AppHapticsService, useValue: { selection } },
        { provide: ONBOARDING_TERRAIN_LOADER, useValue: loader }
      ]
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  async function render() {
    const fixture = TestBed.createComponent(OnboardingTerrainComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('keeps a themed fallback until rendering succeeds and repaints a paused scene on theme changes', async () => {
    const fixture = await render();
    expect(options.dark).toBe(false);
    expect(fixture.nativeElement.querySelector('img').src).toContain(
      'terrain-light.png'
    );
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    options.onReady();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    expect(controller.setMotion).toHaveBeenLastCalledWith(false, false);
    expect(selection).toHaveBeenCalledTimes(1);
    theme.set(AppThemes.Dark);
    fixture.detectChanges();
    expect(controller.setTheme).toHaveBeenLastCalledWith(true);
    expect(fixture.nativeElement.querySelector('img').src).toContain(
      'terrain-dark.png'
    );
  });

  it('starts still for reduced motion and silently responds to preference changes', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_name, callback) => {
        change = callback as typeof change;
      },
      removeEventListener: removeListener
    } as unknown as MediaQueryList);
    const fixture = await render();
    expect(options.playing).toBe(false);
    expect(options.reducedMotion).toBe(true);
    expect(selection).not.toHaveBeenCalled();
    options.onReady();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    expect(controller.setMotion).toHaveBeenLastCalledWith(true, true);
    change({ matches: true } as MediaQueryListEvent);
    expect(controller.setMotion).toHaveBeenLastCalledWith(false, true);
    expect(selection).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(removeListener).toHaveBeenCalledWith('change', change);
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it('uses the current theme when the lazy module finishes loading', async () => {
    let resolve: (value: {
      createTerrainRenderer: typeof createTerrainRenderer;
    }) => void;
    loader.mockReturnValue(
      new Promise((value) => {
        resolve = value;
      })
    );
    const fixture = await render();
    theme.set(AppThemes.Dark);
    fixture.detectChanges();
    resolve!({ createTerrainRenderer });
    await Promise.resolve();
    expect(options.dark).toBe(true);
  });

  it('does not create a renderer after its host has been destroyed', async () => {
    let resolve: (value: {
      createTerrainRenderer: typeof createTerrainRenderer;
    }) => void;
    loader.mockReturnValue(
      new Promise((value) => {
        resolve = value;
      })
    );
    const fixture = await render();
    fixture.destroy();
    resolve!({ createTerrainRenderer });
    await Promise.resolve();
    expect(createTerrainRenderer).not.toHaveBeenCalled();
  });

  it('leaves onboarding usable with a still image when WebGL or module loading fails', async () => {
    loader.mockRejectedValue(new Error('Unavailable'));
    const fixture = await render();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img.is-hidden')).toBeNull();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(selection).not.toHaveBeenCalled();
  });

  it('restores the fallback if the graphics context is lost', async () => {
    const fixture = await render();
    options.onReady();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img.is-hidden')).not.toBeNull();
    options.onUnavailable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img.is-hidden')).toBeNull();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
});
