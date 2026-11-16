import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  InjectionToken,
  NgZone,
  signal,
  viewChild
} from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../../services/app.theme.service';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import type { TerrainController } from './terrain.types';

export const TERRAIN_RENDERER_LOADER = new InjectionToken(
  'shared terrain loader',
  {
    providedIn: 'root',
    factory: () => () => import('./terrain.renderer')
  }
);

@Component({
  selector: 'app-terrain',
  standalone: true,
  templateUrl: './terrain.component.html',
  styleUrl: './terrain.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TerrainComponent {
  private readonly theme = inject(AppThemeService);
  private readonly load = inject(TERRAIN_RENDERER_LOADER);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = inject<ElementRef<HTMLElement>>(ElementRef);
  private controller?: TerrainController;
  private media?: MediaQueryList;
  private reducedMotion = false;
  readonly introVisible = input(false);
  readonly motionPaused = input(false);
  readonly ready = signal(false);
  readonly dark = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly fallback = computed(
    () => `assets/terrain/terrain-${this.dark() ? 'dark' : 'light'}.png`
  );

  constructor() {
    effect(() => {
      if (this.introVisible()) {
        this.zone.runOutsideAngular(() => this.controller?.replayEntry());
      }
    });
    effect(() => {
      const dark = this.dark();
      this.zone.runOutsideAngular(() => this.controller?.setTheme(dark));
    });
    effect(() => {
      const paused = this.motionPaused();
      this.zone.runOutsideAngular(() => this.controller?.setPaused(paused));
    });
    afterNextRender(() => {
      this.media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.media?.matches ?? true;
      this.media?.addEventListener('change', this.onReducedMotion);
      // External frame loop: rendering must not trigger Angular change detection on every frame.
      this.zone.runOutsideAngular(() => {
        void this.load()
          .then(({ createTerrainRenderer }) => {
            if (this.destroyRef.destroyed) return;
            this.controller = createTerrainRenderer(
              this.canvas().nativeElement,
              this.stage.nativeElement,
              {
                dark: this.dark(),
                reducedMotion: this.reducedMotion,
                resizeObserver:
                  BrowserCompatibilityService.checkResizeObserverSupport(),
                intersectionObserver:
                  BrowserCompatibilityService.checkIntersectionObserverSupport(),
                onReady: () => this.zone.run(() => this.ready.set(true)),
                onUnavailable: () =>
                  this.zone.run(() => {
                    this.ready.set(false);
                  })
              }
            );
            this.controller.setPaused(this.motionPaused());
          })
          .catch(() => {
            if (!this.destroyRef.destroyed)
              this.zone.run(() => {
                this.ready.set(false);
              });
          });
      });
    });
    this.destroyRef.onDestroy(() => {
      this.media?.removeEventListener('change', this.onReducedMotion);
      this.controller?.dispose();
    });
  }

  private readonly onReducedMotion = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    this.zone.runOutsideAngular(() =>
      this.controller?.setReducedMotion(this.reducedMotion)
    );
  };
}
