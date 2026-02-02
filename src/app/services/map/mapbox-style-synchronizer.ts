import { MapStyleState, MapStyleServiceInterface } from './map-style.types';

export interface LoggerInterface {
    info(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    error(message: string, meta?: any): void;
}

/**
 * Manages Mapbox style synchronization to prevent race conditions,
 * infinite loops, and redundant updates.
 */
export class MapboxStyleSynchronizer {
    private currentStyleUrl: string | undefined;
    private pendingState: MapStyleState | null = null;
    private isLoading = false;

    constructor(
        private map: any,
        private styleService: MapStyleServiceInterface,
        private logger: LoggerInterface
    ) {
        this.attachListeners();
    }

    /**
     * Request a map style update.
     * Handles buffering if map is currently loading a standard style.
     */
    public update(targetState: MapStyleState) {
        if (!this.map) return;

        // If we are currently loading a style, just queue this new state as the "pending" one.
        // When the load finishes, we will reconcile.
        if (this.isLoading) {
            this.pendingState = targetState;
            this.logger.info('[MapboxStyleSynchronizer] Map loading, queued state', targetState);
            return;
        }

        this.applyState(targetState);
    }

    private applyState(state: MapStyleState) {
        const { styleUrl, preset } = state;

        // Check if Style URL needs changing
        if (this.currentStyleUrl !== styleUrl) {
            this.logger.info('[MapboxStyleSynchronizer] Style URL mismatch, will setStyle', {
                current: this.currentStyleUrl,
                target: styleUrl
            });

            this.isLoading = true;
            this.currentStyleUrl = styleUrl;
            this.pendingState = state; // Keep track of desired preset for when load completes

            try {
                // diff: false prevents some hybrid quirks, forces fresh load
                this.map.setStyle(styleUrl, { diff: false });
            } catch (err) {
                this.logger.error('[MapboxStyleSynchronizer] Error setting style', err);
                this.isLoading = false; // Reset if sync fail
            }
            return;
        }

        // Style URL is same, check/apply preset
        // We delegate to the service's "safe" applier which checks for redundancy
        this.styleService.applyStandardPreset(this.map, styleUrl, preset);
    }

    private attachListeners() {
        if (!this.map || typeof this.map.on !== 'function') return;

        // When a style finishes loading
        this.map.on('style.load', () => {
            this.isLoading = false;
            this.logger.info('[MapboxStyleSynchronizer] style.load (active)', { current: this.currentStyleUrl });
            this.reconcilePending();
        });

        // Handle generic data events or just rely on style.load?
        // TracksComponent used 'styledata' to enforce presets.
        // Since our service's applyStandardPreset is safe (checks value), we can listen to styledata
        // to enforce consistency, BUT we must be careful not to loop.
        // The service check prevents the loop.
        this.map.on('styledata', () => {
            // Only enforce if NOT loading (if loading, style.load will handle it)
            if (!this.isLoading) {
                // If we have a pending state that matches current URL, apply its preset
                // If we don't have pending state, assume currentStyleUrl's preset needs check?
                // Actually, simplest is: if we have a resolved state in mind, apply it.
                // But we don't store "last applied preset" locally strongly enough here except in pendingState.

                // If we rely purely on 'update' calls to drive state, we might not need this listener
                // UNLESS Mapbox resets the preset internally?
                // Users reported they needed it.
                // We can check pendingState OR just re-apply based on currentStyleUrl?
                // But we don't know the DESIRED preset unless we store it.

                // Let's rely on pendingState if present, or just do nothing if we are stable.
                // Re-concile will happen on style.load.
                // If manual styledata happens (e.g. font load), we probably don't need to obscurely set preset.
                // Let's Skip styledata listener for now unless verification fails.
                // The Service's "enforcePresetOnStyleEvents" used it.
                // I'll leave it hooked to reconcile IF we have pending.
                if (this.pendingState) {
                    this.reconcilePending();
                }
            }
        });

        // Error handling?
        this.map.on('error', (e: any) => {
            this.logger.warn('[MapboxStyleSynchronizer] Map error', e);
            // If style load error?
        });
    }

    private reconcilePending() {
        if (!this.pendingState) return;

        const next = this.pendingState;
        // If the pending state requests a DIFFERENT style URL than what we just loaded,
        // we must start over.
        if (next.styleUrl !== this.currentStyleUrl) {
            this.logger.info('[MapboxStyleSynchronizer] Reconcile style URL mismatch', {
                current: this.currentStyleUrl,
                target: next.styleUrl
            });
            this.applyState(next); // This will set isLoading=true again
            return;
        }

        // URL matches, apply the preset
        this.styleService.applyStandardPreset(this.map, next.styleUrl, next.preset);

        // We have satisfied the pending state
        // (Unless applyPreset failed? But we can't do much retrying instantly)
        this.pendingState = null;
    }
}
