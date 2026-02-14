import { Injectable, NgZone } from '@angular/core';
import { snapdom } from '@zumer/snapdom';

export interface ShareBenchmarkOptions {
  watermark?: { brand: string; timestamp: string; url?: string; logoUrl?: string };
  scale?: number;
  width?: number;
  embedFonts?: boolean;
  fast?: boolean;
  renderTimeoutMs?: number;
}

const TRANSPARENT_PIXEL_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

@Injectable({
  providedIn: 'root'
})
export class AppShareService {
  constructor(private zone: NgZone) { }

  async shareBenchmarkAsImage(element: HTMLElement, options: ShareBenchmarkOptions = {}): Promise<string> {
    return this.zone.runOutsideAngular(async () => {
      const scale = options.scale ?? 2;
      const embedFonts = options.embedFonts ?? true;
      const fast = options.fast ?? false;
      const renderTimeoutMs = options.renderTimeoutMs ?? 15000;
      const sourceNode = element;
      const clone = sourceNode.cloneNode(true) as HTMLElement;
      clone.classList.add('benchmark-share-export');
      const exportWidth = options.width ?? sourceNode.offsetWidth;
      clone.style.width = `${exportWidth}px`;
      clone.style.maxWidth = `${exportWidth}px`;
      clone.style.willChange = 'transform';

      const exportContainer = clone.querySelector('.benchmark-container');
      if (exportContainer) {
        exportContainer.classList.add('benchmark-export');
      }

      if (options.watermark) {
        let logoUrl: string | undefined;
        if (options.watermark.logoUrl) {
          const logoIsUsable = await this.loadImage(options.watermark.logoUrl);
          if (logoIsUsable) {
            logoUrl = options.watermark.logoUrl;
          } else {
            console.warn('[AppShareService] Skipping watermark logo: source image cannot be decoded.', options.watermark.logoUrl);
          }
        }
        const watermark = document.createElement('div');
        watermark.className = 'benchmark-watermark';
        watermark.innerHTML = `
          ${options.watermark.brand ? `<div class="watermark-brand-line">${options.watermark.brand}</div>` : ''}
          <div class="watermark-app-line">
            ${logoUrl ? `<img class="watermark-logo" src="${logoUrl}" alt="Quantified Self logo">` : ''}
            <span class="watermark-brand">Quantified Self</span>
          </div>
        `;
        this.applyAngularContentAttr(clone, watermark);
        clone.appendChild(watermark);
      }

      const wrapper = document.createElement('div');
      wrapper.style.position = 'fixed';
      wrapper.style.left = '-10000px';
      wrapper.style.top = '0';
      wrapper.style.width = `${exportWidth}px`;
      wrapper.style.pointerEvents = 'none';
      wrapper.style.zIndex = '-1';
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);

      try {
        const primaryDataUrl = await this.renderCloneToDataUrl(clone, {
          scale,
          width: options.width,
          embedFonts,
          fast,
          renderTimeoutMs,
        });
        return primaryDataUrl;
      } catch (error) {
        if (!this.isSourceDecodeError(error)) {
          throw error;
        }

        // Retry once with reduced complexity for mobile decoders.
        const watermark = clone.querySelector('.benchmark-watermark');
        if (watermark) {
          watermark.remove();
        }
        const fallbackWidth = Number.isFinite(options.width) ? Math.min(options.width!, 720) : Math.min(exportWidth, 720);

        return this.renderCloneToDataUrl(clone, {
          scale: 1,
          width: fallbackWidth,
          embedFonts: true,
          fast: true,
          renderTimeoutMs,
        });
      } finally {
        if (wrapper.parentNode) {
          wrapper.parentNode.removeChild(wrapper);
        }
      }
    });
  }

  private async renderCloneToDataUrl(
    clone: HTMLElement,
    options: {
      scale: number;
      width?: number;
      embedFonts: boolean;
      fast: boolean;
      renderTimeoutMs: number;
    }
  ): Promise<string> {
    await this.waitForIdle();

    const imageBlob = await this.withTimeout(
      snapdom.toBlob(clone, {
        scale: options.scale,
        width: options.width,
        backgroundColor: 'transparent',
        embedFonts: options.embedFonts,
        fast: options.fast,
        type: 'png',
        fallbackURL: TRANSPARENT_PIXEL_DATA_URL,
      }),
      options.renderTimeoutMs,
      `Benchmark image rendering timed out after ${options.renderTimeoutMs}ms.`
    );

    return this.blobToDataUrl(imageBlob);
  }

  private async waitForIdle(): Promise<void> {
    await this.waitForAnimationFrameWithTimeout();
    await this.waitForIdleWithTimeout();
  }

  private waitForAnimationFrameWithTimeout(timeoutMs: number = 120): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timeoutId = window.setTimeout(finish, timeoutMs);
      requestAnimationFrame(() => {
        window.clearTimeout(timeoutId);
        finish();
      });
    });
  }

  private waitForIdleWithTimeout(timeoutMs: number = 300): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeoutId = window.setTimeout(finish, timeoutMs);

      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => {
          window.clearTimeout(timeoutId);
          finish();
        }, { timeout: 250 });
        return;
      }

      window.setTimeout(() => {
        window.clearTimeout(timeoutId);
        finish();
      }, 50);
    });
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finishResolve = (value: T) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      };
      const finishReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      };
      const timeoutId = window.setTimeout(() => finishReject(new Error(message)), timeoutMs);

      promise.then(finishResolve).catch(finishReject);
    });
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read generated image blob.'));
      reader.readAsDataURL(blob);
    });
  }

  private async loadImage(src: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timeoutId = window.setTimeout(() => finish(false), 4000);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        if (typeof img.decode === 'function') {
          try {
            await img.decode();
          } catch {
            // Some browsers may reject decode() for otherwise renderable images.
            // Since onload fired, keep the logo and let render fallback handle failures.
          }
        }
        window.clearTimeout(timeoutId);
        finish(true);
      };
      img.onerror = () => {
        window.clearTimeout(timeoutId);
        finish(false);
      };
      img.src = src;
    });
  }

  private applyAngularContentAttr(scopeEl: HTMLElement, targetEl: HTMLElement): void {
    const contentAttr = scopeEl.getAttributeNames().find(name => name.startsWith('_ngcontent'));
    if (!contentAttr) return;
    const value = scopeEl.getAttribute(contentAttr) || '';
    const apply = (el: Element) => {
      el.setAttribute(contentAttr, value);
      Array.from(el.children).forEach(child => apply(child));
    };
    apply(targetEl);
  }

  private isSourceDecodeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /source image cannot be decoded/i.test(error.message);
  }
}
