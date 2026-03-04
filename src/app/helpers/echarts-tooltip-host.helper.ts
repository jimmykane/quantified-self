const ECHARTS_TOOLTIP_HOST_ID = 'qs-echarts-tooltip-host';
const ECHARTS_TOOLTIP_HOST_Z_INDEX = '1500';

export function getOrCreateEChartsTooltipHost(chartContainer: HTMLElement): HTMLElement {
  const doc = chartContainer?.ownerDocument ?? document;
  const existingHost = doc.getElementById(ECHARTS_TOOLTIP_HOST_ID);
  if (existingHost) {
    return existingHost;
  }

  const host = doc.createElement('div');
  host.id = ECHARTS_TOOLTIP_HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  host.style.overflow = 'hidden';
  host.style.pointerEvents = 'none';
  host.style.zIndex = ECHARTS_TOOLTIP_HOST_Z_INDEX;
  doc.body.appendChild(host);
  return host;
}
