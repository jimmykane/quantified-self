import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { EventInterface } from '@sports-alliance/sports-lib';
import { setEvent } from './utils';
import { GarminHealthAPIEventMetaData } from '@sports-alliance/sports-lib';

export const testEventUpload = functions.region('europe-west2').https.onRequest(async (req, res) => {
    try {
        const userID = req.query.userID as string || 'test-user-id';
        const eventID = req.query.eventID as string || 'test-event-id';

        // Create a dummy event
        const event = {
            getID: () => eventID,
            setID: (id: string) => { }, // Dummy setter
            toJSON: () => ({ id: eventID }),
            getActivities: () => [],
        } as unknown as EventInterface;

        // Add a dummy activity
        const activities = event.getActivities();
        (activities as any[]).push({
            getID: () => 'test-activity-id',
            toJSON: () => ({ id: 'test-activity-id' }),
            getAllExportableStreams: () => [], // No streams for dummy
        });

        // Use body as file content if provided, otherwise dummy
        const fileData = (req.rawBody && req.rawBody.length > 0) ? req.rawBody : Buffer.from('Dummy FIT file content');
        const originalFile = {
            data: fileData,
            extension: 'fit'
        };

        // Dummy Metadata
        const metaData = new GarminHealthAPIEventMetaData(
            userID, 'test-file-id', 'FIT', false, 123456, new Date()
        );

        console.log(`Starting test upload for User: ${userID}, Event: ${eventID}`);
        await setEvent(userID, eventID, event, metaData, originalFile);

        res.status(200).send({
            message: 'Upload successful',
            path: `users/${userID}/events/${eventID}/original.fit`,
            bucket: admin.storage().bucket().name
        });
    } catch (error: any) {
        console.error('Test upload failed:', error);
        res.status(500).send({ error: error.message });
    }
});
