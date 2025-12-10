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

    constructor(private zone: NgZone) { }

    /**
     * Lazily loads amCharts core and charts libraries.
     * Ensures libraries are only loaded once.
     */
    async load(): Promise<AmChartsModules> {
        if (!this.loader) {
            this.loader = Promise.all([
                import('@amcharts/amcharts4/core'),
                import('@amcharts/amcharts4/charts')
            ]).then(([core, charts]) => {
                // Run configuration outside Angular zone to prevent excessive change detection
                this.zone.runOutsideAngular(() => {
                    // Global Options
                    core.options.commercialLicense = true;
                    // core.options.queue = true; // Optional: Enable if you want queued rendering
                    // core.options.onlyShowOnViewport = true; // Optional: Performance boost
                });

                return { core, charts };
            });
        }
        return this.loader;
    }
}
