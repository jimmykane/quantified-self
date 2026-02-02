export type MapStyleName = 'default' | 'satellite' | 'outdoors';

export interface MapStyleState {
    styleUrl: string;
    preset?: 'day' | 'night'; // Only for Standard styles
}

export interface MapStyleServiceInterface {
    isStandard(styleUrl?: string): boolean;
    applyStandardPreset(map: any, styleUrl: string | undefined, preset: 'day' | 'night' | undefined): void;
}
