import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppShareService } from './app.share.service';

const mocks = vi.hoisted(() => {
  const toBlob = vi.fn();
  const mockSnapdom = Object.assign(vi.fn(), { toBlob });
  return { toBlob, mockSnapdom };
});

vi.mock('@zumer/snapdom', () => ({
  snapdom: mocks.mockSnapdom,
}));

describe('AppShareService', () => {
  let service: AppShareService;
  let originalRaf: typeof requestAnimationFrame | undefined;
  let originalRic: ((callback: IdleRequestCallback, options?: IdleRequestOptions) => number) | undefined;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AppShareService],
    });
    service = TestBed.inject(AppShareService);
    vi.clearAllMocks();

    originalRaf = globalThis.requestAnimationFrame;
    originalRic = (window as any).requestIdleCallback;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    (window as any).requestIdleCallback = (cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline);
      return 0;
    };
  });

  afterEach(() => {
    if (originalRaf) {
      globalThis.requestAnimationFrame = originalRaf;
    }
    if (originalRic) {
      (window as any).requestIdleCallback = originalRic;
    } else {
      delete (window as any).requestIdleCallback;
    }
    vi.restoreAllMocks();
  });

  it('returns a png data URL and cleans up the cloned DOM', async () => {
    const source = document.createElement('div');
    mocks.toBlob.mockResolvedValue(new Blob(['abc'], { type: 'image/png' }));

    const result = await service.shareBenchmarkAsImage(source, { width: 800 });

    expect(result).toContain('data:image/png;base64,');
    expect(document.querySelector('.benchmark-share-export')).toBeNull();
  });

  it('adds watermark and export classes to the cloned content', async () => {
    const source = document.createElement('div');
    source.setAttribute('_ngcontent-test', '');
    const container = document.createElement('div');
    container.classList.add('benchmark-container');
    source.appendChild(container);

    let capturedElement: HTMLElement | null = null;
    mocks.toBlob.mockImplementation(async (el: Element) => {
      capturedElement = el as HTMLElement;
      return new Blob(['abc'], { type: 'image/png' });
    });

    await service.shareBenchmarkAsImage(source, {
      width: 960,
      watermark: {
        brand: 'My Brand',
        timestamp: 'Jan 1, 2025',
        url: 'quantified-self.io',
      },
    });

    expect(capturedElement).toBeTruthy();
    expect(capturedElement?.classList.contains('benchmark-share-export')).toBe(true);
    expect(
      capturedElement?.querySelector('.benchmark-container')?.classList.contains('benchmark-export'),
    ).toBe(true);

    const watermark = capturedElement?.querySelector('.benchmark-watermark');
    expect(watermark).toBeTruthy();
    expect(watermark?.querySelector('.watermark-brand-line')?.textContent).toContain('My Brand');
    expect(watermark?.querySelector('.watermark-app-line')?.textContent).toContain('Quantified Self');
    expect(watermark?.textContent).toContain('Quantified Self');
    expect(watermark?.textContent).not.toContain('quantified-self.io');
  });

  it('retries with lightweight options when source decode fails', async () => {
    const source = document.createElement('div');
    mocks.toBlob
      .mockImplementationOnce(async () => {
        throw new Error('The source image cannot be decoded.');
      })
      .mockResolvedValueOnce(new Blob(['abc'], { type: 'image/png' }));

    const result = await service.shareBenchmarkAsImage(source, {
      width: 1080,
      watermark: {
        brand: 'Quantified Self',
        timestamp: 'Jan 1, 2025',
        url: 'quantified-self.io',
      },
    });

    expect(result).toContain('data:image/png;base64,');
    expect(mocks.toBlob).toHaveBeenCalledTimes(2);
  });
});
