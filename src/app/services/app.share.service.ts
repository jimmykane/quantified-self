import { Injectable, NgZone } from '@angular/core';
import { snapdom } from '@zumer/snapdom';

export interface ShareBenchmarkOptions {
  watermark?: { brand: string; timestamp: string; url?: string; logoUrl?: string };
  scale?: number;
  width?: number;
}

@Injectable({
  providedIn: 'root'
})
export class AppShareService {
  constructor(private zone: NgZone) { }

  async shareBenchmarkAsImage(element: HTMLElement, options: ShareBenchmarkOptions = {}): Promise<string> {
    return this.zone.runOutsideAngular(async () => {
      const scale = options.scale ?? 2;
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
        if (options.watermark.logoUrl) {
          await this.loadImage(options.watermark.logoUrl);
        }
        const watermark = document.createElement('div');
        watermark.className = 'benchmark-watermark';
        watermark.innerHTML = `
          <div class="watermark-row">
            ${options.watermark.logoUrl ? `<img class="watermark-logo" src="${options.watermark.logoUrl}" alt="${options.watermark.brand} logo">` : ''}
            <span class="watermark-brand">${options.watermark.brand}</span>
          </div>
          ${options.watermark.url ? `<span class="watermark-url">${options.watermark.url}</span>` : ''}
          <span class="watermark-date">${options.watermark.timestamp}</span>
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
        await this.waitForIdle();

        const image = await snapdom.toPng(clone, {
          scale,
          width: options.width,
          backgroundColor: 'transparent',
          embedFonts: true,
          fast: false,
        });

        return image.src;
      } finally {
        if (wrapper.parentNode) {
          wrapper.parentNode.removeChild(wrapper);
        }
      }
    });
  }

  private async waitForIdle(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if ('requestIdleCallback' in window) {
      await new Promise<void>(resolve => (window as any).requestIdleCallback(() => resolve(), { timeout: 250 }));
    } else {
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
  }

  private async loadImage(src: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve();
      img.onerror = () => resolve();
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
}
