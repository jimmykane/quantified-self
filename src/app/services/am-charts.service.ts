import { Injectable, NgZone } from '@angular/core';
import { LoggerService } from './logger.service';
import { ChartThemes } from '@sports-alliance/sports-lib';

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
    private currentTheme: ChartThemes | null = null;
    private currentUseAnimations: boolean | null = null;

    constructor(private zone: NgZone, private logger: LoggerService) { }

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

    /**
     * Sets the chart theme globally.
     * Prevents re-applying the same theme if already active.
     */
    async setChartTheme(chartTheme: ChartThemes, useAnimations: boolean): Promise<void> {
        if (this.currentTheme === chartTheme && this.currentUseAnimations === useAnimations) {
            // Theme already applied, skip
            return;
        }

        const { core } = await this.load();

        // Run outside angular to avoid change detection on internal amCharts updates
        await this.zone.runOutsideAngular(async () => {
            core.unuseAllThemes();

            this.logger.log(`[Antigravity] Setting chart theme to: ${chartTheme}`);
            this.currentTheme = chartTheme;
            this.currentUseAnimations = useAnimations;

            let themeModule: any;
            try {
                switch (chartTheme) {
                    case 'material': themeModule = await import('@amcharts/amcharts4/themes/material'); break;
                    case 'frozen': themeModule = await import('@amcharts/amcharts4/themes/frozen'); break;
                    case 'dataviz': themeModule = await import('@amcharts/amcharts4/themes/dataviz'); break;
                    case 'dark': themeModule = await import('@amcharts/amcharts4/themes/dark'); break;
                    case 'amcharts': themeModule = await import('@amcharts/amcharts4/themes/amcharts'); break;
                    case 'amchartsdark': themeModule = await import('@amcharts/amcharts4/themes/amchartsdark'); break;
                    case 'moonrisekingdom': themeModule = await import('@amcharts/amcharts4/themes/moonrisekingdom'); break;
                    case 'spiritedaway': themeModule = await import('@amcharts/amcharts4/themes/spiritedaway'); break;
                    case 'kelly': themeModule = await import('@amcharts/amcharts4/themes/kelly'); break;
                    default:
                        this.logger.warn(`[Antigravity] Unknown theme '${chartTheme}', defaulting to material.`);
                        themeModule = await import('@amcharts/amcharts4/themes/material');
                        break;
                }

                if (themeModule && themeModule.default) {
                    this.logger.log(`[Antigravity] Applying theme module for ${chartTheme}`);
                    try {
                        core.useTheme(themeModule.default);
                        this.logger.log(`[Antigravity] Successfully applied theme: ${chartTheme}`);
                    } catch (themeError) {
                        this.logger.error(`[Antigravity] Failed to apply theme ${chartTheme}:`, themeError);
                    }
                } else {
                    this.logger.error(`[Antigravity] Theme module for ${chartTheme} did not load correctly.`);
                }
            } catch (e) {
                this.logger.error(`[Antigravity] Error loading theme ${chartTheme}:`, e);
            }

            // Programmatically enforce dark styles for dark themes
            if (chartTheme === 'dark' || chartTheme === 'amchartsdark') {
                this.applyCustomDarkTheme(core);
            }

            if (useAnimations === true) {
                const animated = await import('@amcharts/amcharts4/themes/animated');
                core.useTheme(animated.default);
            }
        });
    }

    private applyCustomDarkTheme(am4core: typeof Am4Core) {
        const customDarkTheme = (target: any) => {
            // Fix tooltip styles
            if (target instanceof am4core.Tooltip) {
                if (target.background) {
                    target.background.fill = am4core.color("#303030");
                    target.background.stroke = am4core.color("#303030");
                }
                if (target.label) {
                    target.label.fill = am4core.color("#ffffff");
                }
                target.getFillFromObject = false;
            }
            // Fix axis labels (AxisLabel extends Label)
            if (target.className === 'AxisLabel') {
                target.fill = am4core.color("#ffffff");
            }
            // Fix axis titles
            if (target.className === 'Label' && target.parent?.className === 'AxisRendererY') {
                target.fill = am4core.color("#ffffff");
            }
            if (target.className === 'Label' && target.parent?.className === 'AxisRendererX') {
                target.fill = am4core.color("#ffffff");
            }
            // Fix axis range labels (lap numbers, etc.)
            if (target.className === 'AxisLabelCircular' || (target.className === 'Label' && target.parent?.className === 'Grid')) {
                target.fill = am4core.color("#ffffff");
            }
            // Fix legend and bullet labels
            if (target.className === 'Label' && (target.parent?.className === 'LegendDataItem' || target.parent?.className === 'LabelBullet' || target.parent?.className === 'Label')) {
                target.fill = am4core.color("#ffffff");
            }
        };
        am4core.useTheme(customDarkTheme);
    }
}

