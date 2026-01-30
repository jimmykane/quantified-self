import { Injectable } from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { LoggerService } from './logger.service';

export type MapStyleName = 'default' | 'satellite' | 'outdoors';

export interface MapStyleState {
  styleUrl: string;
  preset?: 'day' | 'night'; // Only for Standard styles
}

@Injectable({
  providedIn: 'root'
})
export class MapStyleService {
  // Canonical style URLs
  readonly standard = 'mapbox://styles/mapbox/standard';
  readonly standardSatellite = 'mapbox://styles/mapbox/standard-satellite';
  readonly outdoors = 'mapbox://styles/mapbox/outdoors-v12';

  constructor(private logger: LoggerService) { }

  /**
   * Resolve the style URL (and preset, if applicable) given a logical style + theme.
   */
  public resolve(mapStyle: MapStyleName | undefined, theme: AppThemes): MapStyleState {
    const style = mapStyle ?? 'default';
    switch (style) {
      case 'satellite':
        return { styleUrl: this.standardSatellite, preset: this.getPreset(theme) };
      case 'outdoors':
        return { styleUrl: this.outdoors };
      case 'default':
      default:
        return { styleUrl: this.standard, preset: this.getPreset(theme) };
    }
  }

  public isStandard(styleUrl?: string): boolean {
    return styleUrl === this.standard || styleUrl === this.standardSatellite;
  }

  public getPreset(theme: AppThemes): 'day' | 'night' {
    return theme === AppThemes.Dark ? 'night' : 'day';
  }

  /**
   * Apply the Standard preset if applicable. No retries; logs success/failure.
   */
  public applyStandardPreset(map: any, styleUrl: string | undefined, preset: 'day' | 'night' | undefined) {
    if (!map || typeof map.setConfigProperty !== 'function') {
      this.logger.warn('[MapStyleService] setConfigProperty unavailable; cannot apply preset');
      return;
    }
    if (!this.isStandard(styleUrl) || !preset) return;

    try {
      map.setConfigProperty('basemap', 'lightPreset', preset);
      this.logger.info('[MapStyleService] Applied standard lightPreset', { preset, styleUrl });
    } catch (error) {
      this.logger.error('[MapStyleService] Failed to apply standard lightPreset', { preset, styleUrl, error });
    }
  }

  /**
   * Attach listeners to re-apply preset when the style finishes loading.
   * Should be called once per map instance.
   */
  public enforcePresetOnStyleEvents(map: any, getState: () => { styleUrl?: string, preset?: 'day' | 'night' }) {
    if (!map || !map.on) return;
    const handler = () => {
      const { styleUrl, preset } = getState();
      this.applyStandardPreset(map, styleUrl, preset);
    };
    map.on('style.load', handler);
    map.on('styledata', handler);
  }

  /**
   * Lighten the activity color in dark theme to keep polylines visible.
   */
  public adjustColorForTheme(color: string, theme: AppThemes): string {
    if (theme !== AppThemes.Dark) return color;
    if (!color) return color;
    let hex = color.trim().toLowerCase();
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    if (hex.length !== 6 || !/^[0-9a-f]{6}$/.test(hex)) return color;

    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    let l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    const targetL = 0.70;
    const targetS = 0.8;
    if (l < targetL) {
      l = targetL;
      s = Math.min(1, Math.max(s, targetS * 0.6));
    }

    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    let nr: number, ng: number, nb: number;
    if (s === 0) {
      nr = ng = nb = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      nr = hue2rgb(p, q, h + 1 / 3);
      ng = hue2rgb(p, q, h);
      nb = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
  }
}
