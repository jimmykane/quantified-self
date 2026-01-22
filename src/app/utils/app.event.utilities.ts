
import { ActivityInterface, EventInterface, EventUtilities } from '@sports-alliance/sports-lib';
import { LoggerService } from '../services/logger.service';
import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class AppEventUtilities {

    constructor(private logger: LoggerService) { }

    /**
     * Merges multiple events into one with a guaranteed unique ID.
     * This prevents collision with source events when the deterministic ID generator
     * would produce the same ID (based on startDate bucket).
     * 
     * @param events Array of events to merge
     * @param idGenerator Function that returns a unique ID (e.g., Firestore doc ID generator)
     * @returns Merged event with unique ID
     */
    mergeEventsWithId(events: EventInterface[], idGenerator: () => string): EventInterface {
        const merged = EventUtilities.mergeEvents(events);
        merged.setID(idGenerator());
        return merged;
    }

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
}
