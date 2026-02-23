
import { ActivityInterface, ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { LoggerService } from '../services/logger.service';
import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class AppEventUtilities {

    constructor(private logger: LoggerService) { }

    /**
     * Enriches an activity with missing streams if possible
     * @param activity The activity to enrich
     * @param streamsToEnrich List of stream types to attempt to generate (e.g. ['Time', 'Duration'])
     */
    enrich(activity: ActivityInterface, streamsToEnrich: string[]) {
        if (streamsToEnrich.includes('Time')) {
            this.enrichTimeStream(activity);
        }
        if (streamsToEnrich.includes('Duration')) {
            this.enrichDurationStream(activity);
        }
    }

    private enrichTimeStream(activity: ActivityInterface) {
        if (activity.hasStreamData('Time')) {
            return;
        }

        try {
            // Use native sports-lib generation
            // Cast to any because the interface might not expose generateTimeStream in all versions or typings
            const actAny = activity as any;
            if (actAny.generateTimeStream && actAny.addStream) {
                const timeStream = actAny.generateTimeStream();
                actAny.addStream(timeStream);
            } else {
                this.logger.warn(`[AppEventUtilities] Native generateTimeStream not found on activity ${activity.getID()}`);
            }
        } catch (e) {
            this.logger.error(`[AppEventUtilities] Error generating time stream for activity ${activity.getID()}`, e);
        }
    }

    private enrichDurationStream(activity: ActivityInterface) {
        if (activity.hasStreamData('Duration')) {
            return;
        }

        try {
            const actAny = activity as any;
            if (actAny.generateDurationStream && actAny.addStream) {
                const durationStream = actAny.generateDurationStream();
                actAny.addStream(durationStream);
            } else {
                this.logger.warn(`[AppEventUtilities] Native generateDurationStream not found on activity ${activity.getID()}`);
            }
        } catch (e) {
            this.logger.error(`[AppEventUtilities] Error generating duration stream for activity ${activity.getID()}`, e);
        }
    }

    /**
     * Determines if ascent should be excluded for a given activity type(s)
     * @param activityTypes Array of activity types or a single activity type
     */
    static shouldExcludeAscent(activityTypes: ActivityTypes | ActivityTypes[]): boolean {
        const types = Array.isArray(activityTypes) ? activityTypes : [activityTypes];
        return types.every(type => ActivityTypesHelper.shouldExcludeAscent(type));
    }

    /**
     * Determines if descent should be excluded for a given activity type(s)
     * @param activityTypes Array of activity types or a single activity type
     */
    static shouldExcludeDescent(activityTypes: ActivityTypes | ActivityTypes[]): boolean {
        const types = Array.isArray(activityTypes) ? activityTypes : [activityTypes];
        return types.every(type => ActivityTypesHelper.shouldExcludeDescent(type));
    }
}
