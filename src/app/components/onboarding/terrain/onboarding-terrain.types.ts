export interface TerrainOptions {
  dark: boolean;
  reducedMotion: boolean;
  resizeObserver: boolean;
  intersectionObserver: boolean;
  onReady(): void;
  onUnavailable(): void;
}
export interface TerrainController {
  setTheme(dark: boolean): void;
  setReducedMotion(reducedMotion: boolean): void;
  dispose(): void;
}
