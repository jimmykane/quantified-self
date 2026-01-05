import { Injectable, NgZone } from '@angular/core';

// Type-only imports (these are erased at runtime)
import type * as Am4Core from '@amcharts/amcharts4/core';
import type * as Am4Charts from '@amcharts/amcharts4/charts';

export interface AmChartsModules {
    core: typeof Am4Core;
    charts: typeof Am4Charts;
}

@Injectable({
    providedIn: 'root'
})
export class AmChartsService {
    private loader: Promise<AmChartsModules> | null = null;
    private cachedModules: AmChartsModules | null = null;

    constructor(private zone: NgZone) { }

    /**
     * Lazily loads amCharts core and charts libraries.
     * Ensures libraries are only loaded once.
     */
    async load(): Promise<AmChartsModules> {
        if (!this.loader) {
            this.loader = (async () => {
                const core = await import('@amcharts/amcharts4/core');
                const charts = await import('@amcharts/amcharts4/charts');

                // Run configuration outside Angular zone to prevent excessive change detection
                this.zone.runOutsideAngular(() => {
                    // Global Options
                    core.options.commercialLicense = true;
                    core.options.autoSetClassName = true; // Enable CSS class names for better theming control
                    // core.options.queue = true; // Optional: Enable if you want queued rendering
                    // core.options.onlyShowOnViewport = true; // Optional: Performance boost
                });

                const modules = { core, charts };
                this.cachedModules = modules;
                return modules;
            })();
        }
        return this.loader;
    }

    /**
     * Returns the cached core module if already loaded, otherwise null.
     * Should only be called after load() has been called and awaited.
     */
    getCachedCore(): typeof Am4Core | null {
        return this.cachedModules?.core ?? null;
    }
}

