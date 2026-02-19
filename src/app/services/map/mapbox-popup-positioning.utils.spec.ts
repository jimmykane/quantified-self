import { describe, expect, it } from 'vitest';
import {
  correctPopupPositionToViewport,
  resolvePopupAnchorPosition,
} from './mapbox-popup-positioning.utils';

function createRect(width: number, height: number, left: number = 0, top: number = 0): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('mapbox-popup-positioning.utils', () => {
  it('resolves top-left position clamped in container bounds', () => {
    const mapElement = {
      getBoundingClientRect: () => createRect(300, 200),
    } as HTMLElement;

    const position = resolvePopupAnchorPosition({ x: 290, y: 8 }, mapElement, {
      preferredWidthPx: 240,
      preferredHeightPx: 180,
      marginPx: 12,
      offsetPx: 10,
    });

    expect(position).toEqual({ x: 48, y: 12 });
  });

  it('returns raw projection when map rect is unavailable', () => {
    const mapElement = {
      getBoundingClientRect: () => createRect(0, 0),
    } as HTMLElement;

    const position = resolvePopupAnchorPosition({ x: 101.6, y: 33.2 }, mapElement, {
      preferredWidthPx: 240,
      preferredHeightPx: 180,
    });

    expect(position).toEqual({ x: 102, y: 33 });
  });

  it('corrects rendered popup overflow into viewport', () => {
    const mapElement = {
      getBoundingClientRect: () => createRect(300, 220, 100, 100),
    } as HTMLElement;
    const popupElement = {
      getBoundingClientRect: () => createRect(220, 140, 330, 260),
    } as HTMLElement;

    const corrected = correctPopupPositionToViewport({ x: 230, y: 160 }, mapElement, popupElement, 12);

    expect(corrected).toEqual({ x: 68, y: 68 });
  });
});
