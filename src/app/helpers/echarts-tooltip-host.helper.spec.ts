import { afterEach, describe, expect, it } from 'vitest';

import { getOrCreateEChartsTooltipHost } from './echarts-tooltip-host.helper';

describe('echarts-tooltip-host.helper', () => {
  afterEach(() => {
    document.getElementById('qs-echarts-tooltip-host')?.remove();
    delete (document as Document & { fullscreenElement?: Element | null }).fullscreenElement;
  });

  it('should create a fixed viewport host for echarts tooltips', () => {
    const chartContainer = document.createElement('div');
    document.body.appendChild(chartContainer);

    const host = getOrCreateEChartsTooltipHost(chartContainer);

    expect(host.id).toBe('qs-echarts-tooltip-host');
    expect(host.style.position).toBe('fixed');
    expect(host.style.inset).toBe('0');
    expect(host.style.overflow).toBe('hidden');
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.zIndex).toBe('1500');
  });

  it('should reuse the existing host', () => {
    const chartContainer = document.createElement('div');
    document.body.appendChild(chartContainer);

    const firstHost = getOrCreateEChartsTooltipHost(chartContainer);
    const secondHost = getOrCreateEChartsTooltipHost(chartContainer);

    expect(secondHost).toBe(firstHost);
    expect(document.querySelectorAll('#qs-echarts-tooltip-host')).toHaveLength(1);
  });

  it('should append the tooltip host to the active fullscreen element for fullscreen charts', () => {
    const fullscreenRoot = document.createElement('section');
    const chartContainer = document.createElement('div');
    fullscreenRoot.appendChild(chartContainer);
    document.body.appendChild(fullscreenRoot);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      writable: true,
      value: fullscreenRoot,
    });

    const host = getOrCreateEChartsTooltipHost(chartContainer);

    expect(host.parentElement).toBe(fullscreenRoot);
  });

  it('should move an existing tooltip host into the fullscreen element when fullscreen activates', () => {
    const chartContainer = document.createElement('div');
    document.body.appendChild(chartContainer);

    const host = getOrCreateEChartsTooltipHost(chartContainer);
    expect(host.parentElement).toBe(document.body);

    const fullscreenRoot = document.createElement('section');
    fullscreenRoot.appendChild(chartContainer);
    document.body.appendChild(fullscreenRoot);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      writable: true,
      value: fullscreenRoot,
    });

    const reparentsHost = getOrCreateEChartsTooltipHost(chartContainer);

    expect(reparentsHost).toBe(host);
    expect(reparentsHost.parentElement).toBe(fullscreenRoot);
  });
});
