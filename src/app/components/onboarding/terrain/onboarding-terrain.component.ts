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
import type { TerrainController } from './onboarding-terrain.types';

export const ONBOARDING_TERRAIN_LOADER = new InjectionToken(
  'onboarding terrain loader',
  {
    providedIn: 'root',
    factory: () => () => import('./onboarding-terrain.renderer')
  }
);

@Component({
  selector: 'app-onboarding-terrain',
  standalone: true,
  templateUrl: './onboarding-terrain.component.html',
  styleUrl: './onboarding-terrain.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OnboardingTerrainComponent {
  private readonly theme = inject(AppThemeService);
  private readonly load = inject(ONBOARDING_TERRAIN_LOADER);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = inject<ElementRef<HTMLElement>>(ElementRef);
  private controller?: TerrainController;
  private media?: MediaQueryList;
  private reducedMotion = false;
  readonly introVisible = input(false);
  readonly ready = signal(false);
  readonly dark = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly fallback = computed(
    () => `assets/onboarding/terrain-${this.dark() ? 'dark' : 'light'}.png`
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
