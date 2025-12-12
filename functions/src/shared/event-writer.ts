import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';


export interface FirestoreAdapter {
    setDoc(path: string[], data: any): Promise<void>;
    createBlob(data: Uint8Array): any;
    generateID(): string;
}

export interface StorageAdapter {
    uploadFile(path: string, data: any, metadata?: any): Promise<void>;
}

export class EventWriter {
    constructor(private adapter: FirestoreAdapter, private storageAdapter?: StorageAdapter) { }

    public async writeAllEventData(userID: string, event: EventInterface, originalFile?: { data: any, extension: string }): Promise<void> {
        const writePromises: Promise<void>[] = [];

        // Ensure Event ID
        if (!event.getID()) {
            event.setID(this.adapter.generateID());
        }

        try {
            for (const activity of event.getActivities()) {
                // Ensure Activity ID
                if (!activity.getID()) {
                    activity.setID(this.adapter.generateID());
                }

                const activityJSON = activity.toJSON();
                delete (activityJSON as any).streams;

                // Write Activity
                writePromises.push(
                    this.adapter.setDoc(
                        ['users', userID, 'events', <string>event.getID(), 'activities', <string>activity.getID()],
                        activityJSON
                    )
                );

                // Write Streams - DEPRECATED / REMOVED in favor of file storage
                /*
                for (const stream of activity.getAllExportableStreams()) {
                    try {
                        const compressedStream = this.compressStream(stream.toJSON());
                        writePromises.push(
                            this.adapter.setDoc(
                                [
                                    'users',
                                    userID,
                                    'events',
                                    <string>event.getID(),
                                    'activities',
                                    <string>activity.getID(),
                                    'streams',
                                    stream.type,
                                ],
                                compressedStream
                            )
                        );
                    } catch (e: any) {
                        throw new Error(`Failed to write stream ${stream.type}: ${e.message}`);
                    }
                }
                */
            }

            // Write Event
            const eventJSON = event.toJSON();
            delete (eventJSON as any).activities;

            if (originalFile && this.storageAdapter) {
                const filePath = `users/${userID}/events/${event.getID()}/original.${originalFile.extension}`;
                console.log('[EventWriter] Uploading file to', filePath);
                await this.storageAdapter.uploadFile(filePath, originalFile.data);
                console.log('[EventWriter] Upload complete. Adding metadata to eventJSON');
                (eventJSON as any).originalFile = {
                    path: filePath,
                    bucket: 'quantified-self-io',
                };
            } else {
                console.warn('[EventWriter] Skipping file upload. originalFile:', !!originalFile, 'storageAdapter:', !!this.storageAdapter);
            }

            writePromises.push(
                this.adapter.setDoc(['users', userID, 'events', <string>event.getID()], eventJSON)
            );

            await Promise.all(writePromises);
        } catch (e: any) {
            console.error(e);
            throw new Error('Could not write event data: ' + e.message);
        }
    }

    /*
    private compressStream(stream: StreamJSONInterface): CompressedJSONStreamInterface {
        const compressedStream: CompressedJSONStreamInterface = {
            encoding: CompressionEncodings.None,
            type: stream.type,
            data: JSON.stringify(stream.data),
            compressionMethod: CompressionMethods.None,
        };
    
        // If we can fit it go on (1MB limit approx)
        if (getSize(compressedStream.data) <= 1048487) {
            return compressedStream;
        }
    
        // Then try Pako
        compressedStream.data = this.adapter.createBlob(Pako.gzip(JSON.stringify(stream.data)));
        compressedStream.encoding = CompressionEncodings.UInt8Array;
        compressedStream.compressionMethod = CompressionMethods.Pako;
    
        if (getSize(compressedStream.data) <= 1048487) {
            return compressedStream;
        }
    
        // Throw an error if smaller than a MB still
        throw new Error(
            `Cannot compress stream ${stream.type} its more than 1048487 bytes  ${getSize(
                compressedStream.data
            )}`
        );
    }
        */
}
