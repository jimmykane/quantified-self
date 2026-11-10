export interface TerrainOptions {
  dark: boolean;
  playing: boolean;
  reducedMotion: boolean;
  resizeObserver: boolean;
  intersectionObserver: boolean;
  onReady(): void;
  onUnavailable(): void;
}
export interface TerrainController {
  setTheme(dark: boolean): void;
  setMotion(playing: boolean, reducedMotion: boolean): void;
  dispose(): void;
}
