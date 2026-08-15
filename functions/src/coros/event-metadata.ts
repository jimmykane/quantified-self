import { ServiceNames } from '@sports-alliance/sports-lib';

import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';

/** Service metadata persisted with imported COROS events. */
export class COROSEventMetaData {
  readonly serviceName = ServiceNames.COROSAPI;

  constructor(
    private readonly queueItem: COROSAPIWorkoutQueueItemInterface,
    private readonly date: Date,
  ) {}

  toJSON(): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      serviceWorkoutID: this.queueItem.workoutID,
      serviceName: this.serviceName,
      serviceOpenId: this.queueItem.openId,
      date: this.date.getTime(),
    };

    const optionalMetadata: Record<string, unknown> = {
      serviceMode: this.queueItem.mode,
      serviceSubMode: this.queueItem.subMode,
      serviceDeviceName: this.queueItem.deviceName,
      serviceStartTimezone: this.queueItem.startTimezone,
      serviceEndTimezone: this.queueItem.endTimezone,
      servicePlanWorkoutID: this.queueItem.planWorkoutId,
      serviceWorkoutComponentIndex: this.queueItem.componentIndex,
      serviceWorkoutComponentKey: this.queueItem.componentKey,
      // Old queue items used the expiring URL as their secondary identity.
      // Preserve that legacy shape only until they are re-enqueued with a stable component key.
      serviceFITFileURI: this.queueItem.componentKey ? undefined : this.queueItem.FITFileURI,
    };
    for (const [field, value] of Object.entries(optionalMetadata)) {
      if (value !== undefined && value !== null && value !== '') metadata[field] = value;
    }
    return metadata;
  }
}
