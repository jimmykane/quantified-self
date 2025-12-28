
import { ActivityInterface } from '@sports-alliance/sports-lib';

export class AppEventUtilities {

    /**
     * Enriches an activity with missing streams if possible
     * @param activity The activity to enrich
     * @param streamsToEnrich List of stream types to attempt to generate (e.g. ['Time', 'Duration'])
     */
    static enrich(activity: ActivityInterface, streamsToEnrich: string[]) {
        if (streamsToEnrich.includes('Time')) {
            this.enrichTimeStream(activity);
        }
        if (streamsToEnrich.includes('Duration')) {
            this.enrichDurationStream(activity);
        }
    }

    private static enrichTimeStream(activity: ActivityInterface) {
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
                console.warn(`[AppEventUtilities] Native generateTimeStream not found on activity ${activity.getID()}`);
            }
        } catch (e) {
            console.error(`[AppEventUtilities] Error generating time stream for activity ${activity.getID()}`, e);
        }
    }

    private static enrichDurationStream(activity: ActivityInterface) {
        if (activity.hasStreamData('Duration')) {
            return;
        }

        try {
            const actAny = activity as any;
            if (actAny.generateDurationStream && actAny.addStream) {
                const durationStream = actAny.generateDurationStream();
                actAny.addStream(durationStream);
            } else {
                console.warn(`[AppEventUtilities] Native generateDurationStream not found on activity ${activity.getID()}`);
            }
        } catch (e) {
            console.error(`[AppEventUtilities] Error generating duration stream for activity ${activity.getID()}`, e);
        }
    }
}
