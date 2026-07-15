import { Injectable } from '@angular/core';

export interface IconPinMarkerOptions {
  color: string;
  icon: string;
  svgPath?: string;
  title?: string;
  ariaLabel?: string;
}

export interface EndpointDotMarkerOptions {
  color: string;
  endpoint: 'start' | 'end';
  title?: string;
  ariaLabel?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MarkerFactoryService {

  private createSvgElement(svgContent: string): HTMLDivElement {
    const div = document.createElement('div');
    div.innerHTML = svgContent;
    div.style.cursor = 'pointer';
    return div;
  }

  createPinMarker(color: string): HTMLDivElement {
    return this.createSvgElement(`
        <svg width="24" height="24" viewBox="0 0 24 24" style="overflow: visible;">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                fill="${color}" stroke="#FFF" stroke-width="1.4" stroke-linejoin="round" />
          <circle cx="12" cy="9" r="2.6" fill="#FFF" opacity="0.92" />
        </svg>`);
  }

  createIconPinMarker(options: IconPinMarkerOptions): HTMLDivElement {
    const marker = document.createElement('div');
    marker.style.cursor = 'pointer';
    marker.style.position = 'absolute';
    marker.style.width = '32px';
    marker.style.height = '36px';
    marker.style.display = 'block';

    if (options.title) {
      marker.title = options.title;
    }
    if (options.ariaLabel) {
      marker.setAttribute('aria-label', options.ariaLabel);
      marker.setAttribute('role', 'img');
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '36');
    svg.setAttribute('viewBox', '0 0 32 36');
    svg.style.overflow = 'visible';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M16 1.75C9.7 1.75 4.65 6.8 4.65 13.1c0 7.8 11.35 21.15 11.35 21.15S27.35 20.9 27.35 13.1C27.35 6.8 22.3 1.75 16 1.75Z');
    path.setAttribute('fill', options.color);
    path.setAttribute('stroke', '#FFF');
    path.setAttribute('stroke-width', '1.9');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = options.icon || 'place';
    icon.style.position = 'absolute';
    icon.style.left = '50%';
    icon.style.top = '12.6px';
    icon.style.transform = 'translate(-50%, -50%)';
    icon.style.color = '#fff';
    icon.style.fontSize = '17px';
    icon.style.fontVariationSettings = '"FILL" 1, "wght" 750, "GRAD" 0, "opsz" 20';
    icon.style.lineHeight = '1';
    icon.style.pointerEvents = 'none';

    marker.appendChild(svg);
    marker.appendChild(icon);
    return marker;
  }

  createCompactIconMarker(options: IconPinMarkerOptions): HTMLDivElement {
    const marker = document.createElement('div');
    marker.style.cursor = 'pointer';
    marker.style.position = 'absolute';
    marker.style.width = '22px';
    marker.style.height = '22px';
    marker.style.display = 'flex';
    marker.style.alignItems = 'center';
    marker.style.justifyContent = 'center';
    marker.style.borderRadius = '50%';
    marker.style.backgroundColor = options.color;
    marker.style.border = '2px solid #fff';
    marker.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.35)';

    if (options.title) {
      marker.title = options.title;
    }
    if (options.ariaLabel) {
      marker.setAttribute('aria-label', options.ariaLabel);
      marker.setAttribute('role', 'img');
    }

    if (options.svgPath) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.display = 'block';
      svg.style.pointerEvents = 'none';

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', options.svgPath);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#fff');
      path.setAttribute('stroke-width', '2.7');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      marker.appendChild(svg);
      return marker;
    }

    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = options.icon || 'place';
    icon.style.color = '#fff';
    icon.style.fontSize = '15px';
    icon.style.fontVariationSettings = '"FILL" 1, "wght" 650, "GRAD" 0, "opsz" 20';
    icon.style.lineHeight = '1';
    icon.style.pointerEvents = 'none';

    marker.appendChild(icon);
    return marker;
  }

  createEndpointDotMarker(options: EndpointDotMarkerOptions): HTMLDivElement {
    const marker = document.createElement('div');
    marker.dataset.endpoint = options.endpoint;
    marker.style.position = 'absolute';
    marker.style.width = '14px';
    marker.style.height = '14px';
    marker.style.boxSizing = 'border-box';
    marker.style.display = 'flex';
    marker.style.alignItems = 'center';
    marker.style.justifyContent = 'center';
    marker.style.border = '2px solid #fff';
    marker.style.borderRadius = '50%';
    marker.style.backgroundColor = options.color;
    marker.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.32)';

    if (options.title) {
      marker.title = options.title;
    }
    if (options.ariaLabel) {
      marker.setAttribute('aria-label', options.ariaLabel);
      marker.setAttribute('role', 'img');
    }

    if (options.endpoint === 'end') {
      const center = document.createElement('span');
      center.setAttribute('aria-hidden', 'true');
      center.style.width = '4px';
      center.style.height = '4px';
      center.style.borderRadius = '50%';
      center.style.backgroundColor = '#fff';
      center.style.pointerEvents = 'none';
      marker.appendChild(center);
    }

    return marker;
  }

  createHomeMarker(color: string): HTMLDivElement {
    // M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z is a house icon
    return this.createSvgElement(`
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" fill="${color}" stroke="#FFF" stroke-width="0.8" />
        </svg>`);
  }

  createFlagMarker(color: string): HTMLDivElement {
    return this.createSvgElement(`
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z" fill="${color}" stroke="#FFF" stroke-width="0.8" />
        </svg>`);
  }

  createCursorMarker(color: string): HTMLDivElement {
    const div = this.createSvgElement(`
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="M5 15H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zM12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="${color}" stroke="#FFF" stroke-width="1" />
        </svg>`);
    div.style.transform = 'translateY(50%)';
    return div;
  }

  createLapMarker(color: string, index: number): HTMLDivElement {
    // Unique ID for filter to avoid collisions: shadow-{index}-{random}
    const filterId = `shadow-${index}-${Math.floor(Math.random() * 100000)}`;

    return this.createSvgElement(`
          <svg width="24" height="29" viewBox="-23 -49 46 54" style="overflow: visible;">
             <defs>
               <filter id="${filterId}" x="-20%" y="-20%" width="140%" height="140%">
                 <feGaussianBlur in="SourceAlpha" stdDeviation="1" />
                 <feOffset dx="0" dy="1" />
                 <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
                 <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
               </filter>
             </defs>
             <path d="M22-48h-44v43h16l6 5 6-5h16z" fill="${color}" stroke="#FFF" stroke-width="2" filter="url(#${filterId})" />
             <text x="0" y="-26.5" dominant-baseline="central" text-anchor="middle" fill="white" 
                   style="font-family: 'Roboto', 'Inter', sans-serif; font-size: 16px; font-weight: 800; pointer-events: none;">
               ${index + 1}
             </text>
          </svg>
        `);
  }

  createPointMarker(color: string): HTMLDivElement {
    return this.createSvgElement(`
        <svg width="10" height="10" viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="4" fill="${color}" stroke="#FFF" stroke-width="0.8" />
        </svg>
      `);
  }

  createEventMarker(color: string): HTMLDivElement {
    return this.createSvgElement(`
          <svg width="20" height="20" viewBox="0 0 20 20">
             <circle cx="10" cy="10" r="8" fill="${color}" stroke="black" stroke-width="1" />
          </svg>
        `);
  }

  createClusterMarker(count: number, color?: string): HTMLDivElement {
    const content = document.createElement('div');

    // 10-step "Evil" Heatmap (Vivid Orange -> Blood Red -> Black)
    const steps = [
      { max: 5, size: '30px', bg: '#FF9100', fg: '#000000' }, // Vivid Orange
      { max: 10, size: '30px', bg: '#FF6D00', fg: '#000000' }, // Darker Vivid Orange
      { max: 25, size: '34px', bg: '#F57C00', fg: '#000000' }, // Orange 700
      { max: 50, size: '34px', bg: '#E65100', fg: '#FFFFFF' }, // Orange 900
      { max: 100, size: '38px', bg: '#FF3D00', fg: '#FFFFFF' }, // Deep Orange A400
      { max: 250, size: '38px', bg: '#D50000', fg: '#FFFFFF' }, // Red A700
      { max: 500, size: '42px', bg: '#B71C1C', fg: '#FFFFFF' }, // Red 900
      { max: 1000, size: '42px', bg: '#8B0000', fg: '#FFFFFF' }, // Dark Red
      { max: 2500, size: '46px', bg: '#4A0000', fg: '#FFFFFF' }, // Deep Maroon
      { max: Infinity, size: '50px', bg: '#210000', fg: '#FFFFFF' } // Almost Black
    ];

    const safeCount = Number(count) || 0;
    const config = steps.find(s => safeCount < s.max) || steps[steps.length - 1];

    const bgColor = color || config.bg;
    // If custom color is provided, use white text for contrast, else use config fg
    // Basic heuristic: most activity colors are dark/vivid enough for white text.
    // Ideally we'd check contrast, but white is usually safe for map markers.
    const fgColor = color ? '#FFFFFF' : config.fg;

    content.style.setProperty('background-color', bgColor, 'important');
    content.style.setProperty('background', bgColor, 'important');
    content.style.setProperty('color', fgColor, 'important');

    content.style.borderRadius = '50%';
    content.style.minWidth = config.size;
    content.style.height = config.size;
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.justifyContent = 'center';
    content.style.fontWeight = 'bold';
    content.style.padding = '8px'; // Add padding to size (content-box behavior)
    content.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
    content.style.border = '2px solid white';
    content.style.fontSize = '13px';
    content.textContent = String(safeCount);
    return content;
  }

  /**
   * Creates a jump marker using the Material Design "flight" icon.
   * Used to display jump events on the map.
   */
  createJumpMarker(color: string, size = 28): HTMLDivElement {
    // Solid colored circle with a white arrow icon on top
    return this.createSvgElement(`
        <svg width="${size}" height="${size}" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="${color}" stroke="#FFF" stroke-width="0.8" />
          <path d="M13.88 11.54L8.92 16.5l-1.41-1.41 4.96-4.96L10.34 8l5.65.01.01 5.65-2.12-2.12z" 
                fill="#FFF" />
        </svg>`);
  }
}
