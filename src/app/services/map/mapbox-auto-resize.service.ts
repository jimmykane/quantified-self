import { Injectable } from '@angular/core';
import { LoggerService } from '../logger.service';

export interface MapboxAutoResizeConfig {
  container?: HTMLElement | null;
  onResize?: () => void;
  triggerInitialResize?: boolean;
  throttleMs?: number;
}

interface AutoResizeBinding {
  handler: () => void;
  observer: ResizeObserver | null;
  frameId: number | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
  lastResizeAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class MapboxAutoResizeService {
  private bindingsByMap = new WeakMap<any, AutoResizeBinding>();

  constructor(private logger: LoggerService) { }

  public bind(map: any, config: MapboxAutoResizeConfig = {}): void {
    if (!map) return;

    this.unbind(map);

    const binding: AutoResizeBinding = {
      handler: () => { },
      observer: null,
      frameId: null,
      timeoutId: null,
      lastResizeAt: 0
    };
    const throttleMs = this.normalizeThrottleMs(config.throttleMs);

    const triggerResize = () => {
      if (!map?.resize) return;

      const runResizeNow = () => {
        try {
          map.resize();
        } catch (error) {
          this.logger.warn('[MapboxAutoResizeService] Failed to resize map.', { error });
          return;
        }

        binding.lastResizeAt = Date.now();
        config.onResize?.();
      };

      const runViaAnimationFrame = () => {
        if (typeof requestAnimationFrame === 'function') {
          if (binding.frameId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(binding.frameId);
          }
          binding.frameId = requestAnimationFrame(() => {
            binding.frameId = null;
            runResizeNow();
          });
          return;
        }

        runResizeNow();
      };

      const elapsedMs = Date.now() - binding.lastResizeAt;
      if (binding.lastResizeAt === 0 || elapsedMs >= throttleMs) {
        if (binding.timeoutId !== null) {
          clearTimeout(binding.timeoutId);
          binding.timeoutId = null;
        }
        runViaAnimationFrame();
        return;
      }

      if (binding.timeoutId !== null) {
        return;
      }

      const waitMs = Math.max(0, throttleMs - elapsedMs);
      binding.timeoutId = setTimeout(() => {
        binding.timeoutId = null;
        runViaAnimationFrame();
      }, waitMs);
    };

    binding.handler = triggerResize;
    this.bindingsByMap.set(map, binding);

    if (map?.on) {
      map.on('load', triggerResize);
      map.on('style.load', triggerResize);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', triggerResize);
      window.addEventListener('orientationchange', triggerResize);
      window.visualViewport?.addEventListener?.('resize', triggerResize);
    }

    const container = config.container;
    if (typeof ResizeObserver !== 'undefined' && container) {
      binding.observer = new ResizeObserver(() => triggerResize());
      binding.observer.observe(container);
    }

    if (config.triggerInitialResize !== false) {
      setTimeout(triggerResize, 0);
    }
  }

  public unbind(map: any): void {
    if (!map) return;
    const binding = this.bindingsByMap.get(map);
    if (!binding) return;

    const handler = binding.handler;

    if (map?.off) {
      map.off('load', handler);
      map.off('style.load', handler);
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
      window.visualViewport?.removeEventListener?.('resize', handler);
    }

    if (binding.observer) {
      binding.observer.disconnect();
      binding.observer = null;
    }

    if (binding.frameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(binding.frameId);
      binding.frameId = null;
    }
    if (binding.timeoutId !== null) {
      clearTimeout(binding.timeoutId);
      binding.timeoutId = null;
    }

    this.bindingsByMap.delete(map);
  }

  private normalizeThrottleMs(inputThrottleMs: number | undefined): number {
    if (typeof inputThrottleMs !== 'number' || !Number.isFinite(inputThrottleMs)) {
      return 300;
    }
    return Math.max(0, inputThrottleMs);
  }
}
