export type MapStyleName = 'default' | 'satellite' | 'outdoors';

export interface MapStyleOption {
    value: MapStyleName;
    label: string;
}

export const SUPPORTED_MAP_STYLES: readonly MapStyleName[] = ['default', 'satellite', 'outdoors'] as const;

export interface MapStyleState {
    styleUrl: string;
    preset?: 'day' | 'night'; // Only for Standard styles
}

export interface MapStyleServiceInterface {
    isStandard(styleUrl?: string): boolean;
    applyStandardPreset(map: any, styleUrl: string | undefined, preset: 'day' | 'night' | undefined): void;
}
