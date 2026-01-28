import { Injectable } from '@angular/core';

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
        <svg width="24" height="24" viewBox="0 -24 24 24">
          <path d="M22-48h-44v43h16l6 5 6-5h16z" fill="${color}" stroke="#FFF" stroke-width="0.5" transform="scale(0.5) translate(22, 48)" />
        </svg>`);
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
  createJumpMarker(color: string): HTMLDivElement {
    // Solid colored circle with a white arrow icon on top
    return this.createSvgElement(`
        <svg width="28" height="28" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="${color}" stroke="#FFF" stroke-width="0.8" />
          <path d="M13.88 11.54L8.92 16.5l-1.41-1.41 4.96-4.96L10.34 8l5.65.01.01 5.65-2.12-2.12z" 
                fill="#FFF" />
        </svg>`);
  }
}

