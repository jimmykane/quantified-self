import { Injectable, NgZone } from '@angular/core';
import { snapdom } from '@zumer/snapdom';
import { BrowserCompatibilityService } from './browser.compatibility.service';

export interface ShareBenchmarkOptions {
  watermark?: { brand: string; timestamp: string; url?: string; logoUrl?: string };
  scale?: number;
  width?: number;
  embedFonts?: boolean;
  fast?: boolean;
  renderTimeoutMs?: number;
}

export interface ShareElementImageOptions {
  scale?: number;
  width?: number;
  embedFonts?: boolean;
  fast?: boolean;
  renderTimeoutMs?: number;
  exportClassName?: string;
  backgroundColor?: string;
}

const TRANSPARENT_PIXEL_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

@Injectable({
  providedIn: 'root'
})
export class AppShareService {
  constructor(
    private zone: NgZone,
    private browserCompatibilityService: BrowserCompatibilityService,
  ) { }

  async copyElementImageToClipboard(element: HTMLElement, options: ShareElementImageOptions = {}): Promise<void> {
    return this.zone.runOutsideAngular(async () => {
      if (!this.browserCompatibilityService.checkClipboardImageWriteSupport()) {
        throw new Error('Image clipboard copy is not supported by this browser.');
      }

      const imageBlobPromise = this.renderElementAsImageBlob(element, options);
      const item = new ClipboardItem({
        'image/png': imageBlobPromise,
      });

      await navigator.clipboard.write([item]);
    });
  }

  async renderElementAsImageBlob(element: HTMLElement, options: ShareElementImageOptions = {}): Promise<Blob> {
    return this.zone.runOutsideAngular(async () => {
      const scale = options.scale ?? 2;
      const embedFonts = options.embedFonts ?? true;
      const fast = options.fast ?? false;
      const renderTimeoutMs = options.renderTimeoutMs ?? 15000;
      const exportWidth = options.width ?? element.offsetWidth;
      const clone = element.cloneNode(true) as HTMLElement;
      if (options.exportClassName) {
        clone.classList.add(options.exportClassName);
      }
      if (options.backgroundColor) {
        clone.style.backgroundColor = options.backgroundColor;
      }
      clone.style.width = `${exportWidth}px`;
      clone.style.maxWidth = `${exportWidth}px`;
      clone.style.willChange = 'transform';
      this.copyCanvasContent(element, clone);

      const wrapper = this.attachExportClone(clone, exportWidth);

      try {
        return await this.renderCloneToBlobWithFallback(clone, {
          scale,
          width: options.width,
          embedFonts,
          fast,
          renderTimeoutMs,
          backgroundColor: options.backgroundColor ?? 'transparent',
        }, exportWidth);
      } finally {
        this.removeExportWrapper(wrapper);
      }
    });
  }

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
      this.copyCanvasContent(sourceNode, clone);

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

      const wrapper = this.attachExportClone(clone, exportWidth);

      try {
        const imageBlob = await this.renderCloneToBlobWithFallback(clone, {
          scale,
          width: options.width,
          embedFonts,
          fast,
          renderTimeoutMs,
          backgroundColor: 'transparent',
        }, exportWidth, () => clone.querySelector('.benchmark-watermark')?.remove());
        return this.blobToDataUrl(imageBlob);
      } finally {
        this.removeExportWrapper(wrapper);
      }
    });
  }

  private async renderCloneToBlob(
    clone: HTMLElement,
    options: {
      scale: number;
      width?: number;
      embedFonts: boolean;
      fast: boolean;
      renderTimeoutMs: number;
      backgroundColor: string;
    }
  ): Promise<Blob> {
    await this.waitForIdle();

    return this.withTimeout(
      snapdom.toBlob(clone, {
        scale: options.scale,
        width: options.width,
        backgroundColor: options.backgroundColor,
        embedFonts: options.embedFonts,
        fast: options.fast,
        type: 'png',
        fallbackURL: TRANSPARENT_PIXEL_DATA_URL,
      }),
      options.renderTimeoutMs,
      `Image rendering timed out after ${options.renderTimeoutMs}ms.`
    );
  }

  private async renderCloneToBlobWithFallback(
    clone: HTMLElement,
    options: {
      scale: number;
      width?: number;
      embedFonts: boolean;
      fast: boolean;
      renderTimeoutMs: number;
      backgroundColor: string;
    },
    exportWidth: number,
    beforeFallback?: () => void,
  ): Promise<Blob> {
    try {
      return await this.renderCloneToBlob(clone, options);
    } catch (error) {
      if (!this.isRecoverableRenderError(error)) {
        throw error;
      }

      beforeFallback?.();
      return this.renderCloneToBlob(clone, {
        ...options,
        scale: 1,
        width: Math.min(options.width ?? exportWidth, 720),
        embedFonts: false,
        fast: true,
      });
    }
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

  private attachExportClone(clone: HTMLElement, exportWidth: number): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-10000px';
    wrapper.style.top = '0';
    wrapper.style.width = `${exportWidth}px`;
    wrapper.style.pointerEvents = 'none';
    wrapper.style.zIndex = '-1';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    return wrapper;
  }

  private removeExportWrapper(wrapper: HTMLElement): void {
    if (wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper);
    }
  }

  private copyCanvasContent(sourceNode: HTMLElement, cloneNode: HTMLElement): void {
    const sourceCanvases = this.collectCanvases(sourceNode);
    const cloneCanvases = this.collectCanvases(cloneNode);

    sourceCanvases.forEach((sourceCanvas, index) => {
      const cloneCanvas = cloneCanvases[index];
      if (!cloneCanvas) {
        return;
      }

      cloneCanvas.width = sourceCanvas.width;
      cloneCanvas.height = sourceCanvas.height;
      cloneCanvas.style.width = sourceCanvas.style.width || `${sourceCanvas.offsetWidth}px`;
      cloneCanvas.style.height = sourceCanvas.style.height || `${sourceCanvas.offsetHeight}px`;

      const context = cloneCanvas.getContext('2d');
      if (!context) {
        return;
      }

      try {
        context.drawImage(sourceCanvas, 0, 0);
      } catch {
        // If a canvas is tainted, let the DOM renderer attempt its own fallback.
      }
    });
  }

  private collectCanvases(element: HTMLElement): HTMLCanvasElement[] {
    const canvases = Array.from(element.querySelectorAll('canvas'));
    if (element instanceof HTMLCanvasElement) {
      return [element, ...canvases];
    }
    return canvases;
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

  private isRecoverableRenderError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /source image cannot be decoded|image rendering timed out/i.test(error.message);
  }
}
