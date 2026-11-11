import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeService } from '../../../services/app.theme.service';
import {
  ONBOARDING_TERRAIN_LOADER,
  OnboardingTerrainComponent
} from './onboarding-terrain.component';
import type { TerrainOptions } from './onboarding-terrain.types';

describe('OnboardingTerrainComponent', () => {
  const theme = signal(AppThemes.Normal);
  const controller = {
    setTheme: vi.fn(),
    setReducedMotion: vi.fn(),
    replayEntry: vi.fn(),
    dispose: vi.fn()
  };
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

  it('keeps a themed fallback until rendering succeeds and repaints the scene on theme changes', async () => {
    const fixture = await render();
    expect(options.dark).toBe(false);
    expect(fixture.nativeElement.querySelector('img').src).toContain(
      'terrain-light.png'
    );
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    options.onReady();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('canvas.is-ready')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    theme.set(AppThemes.Dark);
    fixture.detectChanges();
    expect(controller.setTheme).toHaveBeenLastCalledWith(true);
    expect(fixture.nativeElement.querySelector('img').src).toContain(
      'terrain-dark.png'
    );
  });

  it('replays the glide when entering the intro, without replaying for theme changes or leaving', async () => {
    const fixture = await render();
    expect(controller.replayEntry).not.toHaveBeenCalled();
    fixture.componentRef.setInput('introVisible', true);
    fixture.detectChanges();
    expect(controller.replayEntry).toHaveBeenCalledTimes(1);
    theme.set(AppThemes.Dark);
    fixture.detectChanges();
    fixture.componentRef.setInput('introVisible', false);
    fixture.detectChanges();
    expect(controller.replayEntry).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('introVisible', true);
    fixture.detectChanges();
    expect(controller.replayEntry).toHaveBeenCalledTimes(2);
    expect(createTerrainRenderer).toHaveBeenCalledTimes(1);
  });

  it('disables parallax for reduced motion and responds to preference changes', async () => {
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
    expect(options.reducedMotion).toBe(true);
    options.onReady();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    change({ matches: false } as MediaQueryListEvent);
    expect(controller.setReducedMotion).toHaveBeenLastCalledWith(false);
    change({ matches: true } as MediaQueryListEvent);
    expect(controller.setReducedMotion).toHaveBeenLastCalledWith(true);
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
