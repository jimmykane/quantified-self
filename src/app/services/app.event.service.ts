import { inject, Injectable, Injector, OnDestroy, runInInjectionContext } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityParsingOptions } from '@sports-alliance/sports-lib';
import { EventImporterJSON } from '@sports-alliance/sports-lib';
import { combineLatest, from, Observable, of, zip } from 'rxjs';
import { Firestore, collection, query, orderBy, where, limit, startAfter, endBefore, collectionData, doc, docData, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, DocumentSnapshot, QueryDocumentSnapshot, CollectionReference, getCountFromServer } from '@angular/fire/firestore';
import { catchError, map, switchMap, take, distinctUntilChanged } from 'rxjs/operators';
import { EventJSONInterface } from '@sports-alliance/sports-lib';
import { ActivityJSONInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { StreamInterface } from '@sports-alliance/sports-lib';
import { EventExporterJSON } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { Privacy } from '@sports-alliance/sports-lib';
import { AppWindowService } from './app.window.service';
import {
  EventMetaDataInterface,
  ServiceNames
} from '@sports-alliance/sports-lib';
import { EventExporterGPX } from '@sports-alliance/sports-lib';

import { EventWriter, FirestoreAdapter, StorageAdapter, OriginalFile } from '../../../functions/src/shared/event-writer';
import { generateActivityID, generateEventID } from '../../../functions/src/shared/id-generator';
import { Bytes } from 'firebase/firestore';
import { Storage, ref, uploadBytes, getBytes } from '@angular/fire/storage';
import { EventImporterSuuntoJSON } from '@sports-alliance/sports-lib';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { EventImporterTCX } from '@sports-alliance/sports-lib';
import { EventImporterGPX } from '@sports-alliance/sports-lib';
import { EventImporterSuuntoSML } from '@sports-alliance/sports-lib';
import { EventUtilities } from '@sports-alliance/sports-lib';


import { EventJSONSanitizer } from '../utils/event-json-sanitizer';

import { AppUserService } from './app.user.service';
import { USAGE_LIMITS } from '../../../functions/src/shared/limits';
import { AppEventInterface } from '../../../functions/src/shared/app-event.interface'; // Import Shared Interface
import { AppEventUtilities } from '../utils/app.event.utilities';
import { LoggerService } from './logger.service';
import { AppFileService } from './app.file.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';


@Injectable({
  providedIn: 'root',
})
export class AppEventService implements OnDestroy {

  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private injector = inject(Injector);
  private fileService = inject(AppFileService);
  private logger = inject(LoggerService);
  private appEventUtilities = inject(AppEventUtilities);
  private static reportedUnknownTypes = new Set<string>();

  /**
   * NOTE: We use `runInInjectionContext(this.injector, ...)` for Firebase SDK calls (doc, collection, etc.).
   * This is required because AngularFire v7+ needs an active injection context to correctly integrate 
   * with Zone.js, Change Detection, and Hydration. Without this wrapper, calls made after construction 
   * time (like in async methods) would lose context and cause console warnings or hydration bugs.
   */
  constructor(
    private windowService: AppWindowService) {
  }

  public getEventAndActivities(user: User, eventID: string): Observable<AppEventInterface> {
    // See
    // https://stackoverflow.com/questions/42939978/avoiding-nested-subscribes-with-combine-latest-when-one-observable-depends-on-th
    const eventDoc = runInInjectionContext(this.injector, () => doc(this.firestore, 'users', user.uid, 'events', eventID));
    return combineLatest([
      runInInjectionContext(this.injector, () => docData(eventDoc)).pipe(
        map(eventSnapshot => {
          if (!eventSnapshot) return null;
          const { sanitizedJson } = EventJSONSanitizer.sanitize(eventSnapshot);
          const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(eventID) as AppEventInterface;

          // Hydrate with original file(s) info if present
          const rawData = eventSnapshot as any;

          if (rawData.originalFiles) {
            event.originalFiles = rawData.originalFiles.map((file: any) => {
              if (file.startDate) {
                // Convert Firestore Timestamp to Date
                if (file.startDate.toDate && typeof file.startDate.toDate === 'function') {
                  file.startDate = file.startDate.toDate();
                } else if (file.startDate.seconds !== undefined) {
                  file.startDate = new Date(file.startDate.seconds * 1000 + (file.startDate.nanoseconds || 0) / 1000000);
                } else if (typeof file.startDate === 'string') {
                  file.startDate = new Date(file.startDate);
                }
              } else {
                throw new Error('Event Metadata Error: Missing startDate for file ' + file.path);
              }
              return file;
            });
          }
          if (rawData.originalFile) {
            event.originalFile = rawData.originalFile;
          }

          return event;
        })),
      this.getActivities(user, eventID),
    ]).pipe(
      distinctUntilChanged((prev, curr) => {
        const prevEvent = prev[0];
        const prevActivities = prev[1];
        const currEvent = curr[0];
        const currActivities = curr[1];

        // Check Event ID Equality
        if (prevEvent?.getID() !== currEvent?.getID()) {
          return false;
        }

        // Check Activities Length Equality
        if (prevActivities?.length !== currActivities?.length) {
          return false;
        }

        // Check Activities IDs Equality
        // We assume order is consistent (which it generally is for combineLatest emitting same array ref or Firestore query)
        // A safer bet is to check every ID.
        if (prevActivities && currActivities) {
          for (let i = 0; i < prevActivities.length; i++) {
            if (prevActivities[i].getID() !== currActivities[i].getID()) {
              return false;
            }
          }
        }
        return true;
      }),
      catchError((error) => {
        if (error && error.code && error.code === 'permission-denied') {
          return of([null, null] as [AppEventInterface | null, ActivityInterface[] | null]);
        }
        this.logger.error('Error fetching event or activities:', error);

        return of([null, null] as [AppEventInterface | null, ActivityInterface[] | null]); // @todo fix this
      })).pipe(map(([event, activities]: [AppEventInterface, ActivityInterface[]]) => {
        if (!event) {
          return null;
        }
        event.clearActivities();
        event.addActivities(activities);
        return event;
      })).pipe(catchError((error) => {
        // debugger;
        this.logger.error('Error adding activities to event:', error);

        return of(null); // @todo is this the best we can do?
      }))
  }

  public getEventsBy(user: User, where: { fieldPath: string | any, opStr: any, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    if (startAfter || endBefore) {
      return this.getEventsStartingAfterOrEndingBefore(user, false, where, orderBy, asc, limit, startAfter, endBefore);
    }
    return this._getEvents(user, where, orderBy, asc, limit);
  }

  public getEventsOnceBy(user: User, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10): Observable<EventInterface[]> {
    const q = this.getEventQueryForUser(user, whereClauses, orderByField, asc, limitCount);
    return from(runInInjectionContext(this.injector, () => getDocs(q))).pipe(map((querySnapshot) => {
      return querySnapshot.docs.map((queryDocumentSnapshot) => {
        const eventSnapshot = queryDocumentSnapshot.data();
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(eventSnapshot);
        if (unknownTypes.length > 0) {
          const newUnknownTypes = unknownTypes.filter(type => !AppEventService.reportedUnknownTypes.has(type));
          if (newUnknownTypes.length > 0) {
            newUnknownTypes.forEach(type => AppEventService.reportedUnknownTypes.add(type));
            this.logger.captureMessage('Unknown Data Types in getEventsOnceBy', { extra: { types: newUnknownTypes, eventID: queryDocumentSnapshot.id } });
          }
        }
        const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(queryDocumentSnapshot.id) as AppEventInterface;

        // Hydrate with original file(s) info if present
        const rawData = eventSnapshot as any;
        if (rawData.originalFiles) {
          event.originalFiles = rawData.originalFiles;
        }
        if (rawData.originalFile) {
          event.originalFile = rawData.originalFile;
        }

        return event;
      });
    }));
  }

  /**
   * @Deprecated
   * @param user
   * @param where
   * @param orderBy
   * @param asc
   * @param limit
   * @param startAfter
   * @param endBefore
   */
  public getEventsAndActivitiesBy(user: User, where: { fieldPath: string | any, opStr: any, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    if (startAfter || endBefore) {
      return this.getEventsStartingAfterOrEndingBefore(user, true, where, orderBy, asc, limit, startAfter, endBefore);
    }
    return this._getEventsAndActivities(user, where, orderBy, asc, limit);
  }

  /**
   * Gets the event, activities and some streams depending on the types provided
   * @param user
   * @param eventID
   * @param streamTypes
   */
  public getEventActivitiesAndSomeStreams(user: User, eventID: string, streamTypes: string[]) {
    return this._getEventActivitiesAndAllOrSomeStreams(user, eventID, streamTypes);
  }

  /**
   * Get's the event, activities and all available streams
   * @param user
   * @param eventID
   */
  public getEventActivitiesAndAllStreams(user: User, eventID: string) {
    return this._getEventActivitiesAndAllOrSomeStreams(user, eventID);
  }

  public getActivities(user: User, eventID: string): Observable<ActivityInterface[]> {
    const activitiesCollection = runInInjectionContext(this.injector, () => collection(this.firestore, 'users', user.uid, 'activities'));
    const q = runInInjectionContext(this.injector, () => query(activitiesCollection, where('eventID', '==', eventID)));
    return (runInInjectionContext(this.injector, () => collectionData(q, { idField: 'id' })) as Observable<any[]>).pipe(
      map((activitySnapshots: any[]) => {
        return activitySnapshots.reduce((activitiesArray: ActivityInterface[], activitySnapshot: any) => {
          try {
            // Ensure required properties exist for sports-lib 6.x compatibility
            const safeActivityData = {
              ...activitySnapshot,
              stats: activitySnapshot.stats || {},
              laps: activitySnapshot.laps || [],
              streams: activitySnapshot.streams || [],
              intensityZones: activitySnapshot.intensityZones || [],
              events: activitySnapshot.events || []
            };
            const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(safeActivityData);
            if (unknownTypes.length > 0) {
              const newUnknownTypes = unknownTypes.filter(type => !AppEventService.reportedUnknownTypes.has(type));
              if (newUnknownTypes.length > 0) {
                newUnknownTypes.forEach(type => AppEventService.reportedUnknownTypes.add(type));
                this.logger.captureMessage('Unknown Data Types in getActivities', { extra: { types: newUnknownTypes, eventID, activityID: activitySnapshot.id } });
              }
            }
            activitiesArray.push(EventImporterJSON.getActivityFromJSON(<ActivityJSONInterface>sanitizedJson).setID(activitySnapshot.id));
          } catch (e) {
            this.logger.error('Failed to parse activity:', activitySnapshot.id, 'Error:', e);
          }
          return activitiesArray;
        }, []);
      }),
    )
  }

  public getEventMetaData(user: User, eventID: string, serviceName: ServiceNames): Observable<EventMetaDataInterface> {
    const metaDataDoc = runInInjectionContext(this.injector, () => doc(this.firestore, 'users', user.uid, 'events', eventID, 'metaData', serviceName));
    return runInInjectionContext(this.injector, () => docData(metaDataDoc)).pipe(
      map(metaDataSnapshot => {
        return <EventMetaDataInterface>metaDataSnapshot;
      }),
    )
  }

  public getEventMetaDataKeys(user: User, eventID: string): Observable<string[]> {
    const metaDataCollection = runInInjectionContext(this.injector, () => collection(this.firestore, 'users', user.uid, 'events', eventID, 'metaData'));
    return from(runInInjectionContext(this.injector, () => getDocs(metaDataCollection))).pipe(
      map((querySnapshot) => querySnapshot.docs.map(doc => doc.id))
    );
  }

  /**
   * @deprecated Streams are no longer stored in Firestore. Use attachStreamsToEventWithActivities instead.
   */
  public getAllStreams(user: User, eventID: string, activityID: string): Observable<StreamInterface[]> {
    this.logger.warn('[AppEventService] getAllStreams is deprecated and will likely return empty results.');
    const streamsCollection = runInInjectionContext(this.injector, () => collection(this.firestore, 'users', user.uid, 'activities', activityID, 'streams'));
    return from(runInInjectionContext(this.injector, () => getDocs(streamsCollection))) // @todo replace with snapshot changes I suppose when @https://github.com/angular/angularfire2/issues/1552 is fixed
      .pipe(map((querySnapshot) => {
        return querySnapshot.docs.map(queryDocumentSnapshot => this.processStreamQueryDocumentSnapshot(queryDocumentSnapshot))
      }))
  }

  /**
   * @deprecated Streams are no longer stored in Firestore. Use attachStreamsToEventWithActivities instead.
   */
  public getStream(user: User, eventID: string, activityID: string, streamType: string): Observable<StreamInterface> {
    this.logger.warn('[AppEventService] getStream is deprecated and will likely return empty results.');
    return from(runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'users', user.uid, 'activities', activityID, 'streams', streamType))))
      .pipe(map((queryDocumentSnapshot) => {
        // getDoc returns DocumentSnapshot, ensure data exists
        if (!queryDocumentSnapshot.exists()) return null; // Handle missing stream
        return this.processStreamDocumentSnapshot(queryDocumentSnapshot) // DocumentSnapshot is a DocumentData
      }))
  }

  public getStreamsByTypes(userID: string, eventID: string, activityID: string, types: string[]): Observable<StreamInterface[]> {
    types = [...new Set(types)]
    // if >10 to be split into x batches of work and use merge due to firestore not taking only up to 10 in in operator
    const batchSize = 10 // Firstore limitation
    const x = types.reduce((all, one, i) => {
      const ch = Math.floor(i / batchSize);
      all[ch] = [].concat((all[ch] || []), one);
      return all
    }, []).map((typesBatch) => {
      const streamsCollection = runInInjectionContext(this.injector, () => collection(this.firestore, 'users', userID, 'activities', activityID, 'streams'));
      const q = runInInjectionContext(this.injector, () => query(streamsCollection, where('type', 'in', typesBatch)));
      return from(runInInjectionContext(this.injector, () => getDocs(q)))
        .pipe(map((documentSnapshots) => {
          return documentSnapshots.docs.reduce((streamArray: StreamInterface[], documentSnapshot) => {
            streamArray.push(this.processStreamDocumentSnapshot(documentSnapshot));
            return streamArray;
          }, []);
        }))
    })

    return combineLatest(x).pipe(map(arrayOfArrays => arrayOfArrays.reduce((a, b) => a.concat(b), [])));
  }

  public async writeAllEventData(user: User, event: AppEventInterface, originalFiles?: OriginalFile[] | OriginalFile) {
    // 0. Ensure deterministic IDs to prevent duplicates
    if (!event.getID()) {
      event.setID(await generateEventID(user.uid, event.startDate));
    }
    const eventID = event.getID();
    const activities = event.getActivities();
    for (let i = 0; i < activities.length; i++) {
      if (!activities[i].getID()) {
        activities[i].setID(await generateActivityID(eventID, i));
      }
    }

    // 1. Check Pro Status
    const userService = this.injector.get(AppUserService);
    const isPro = await userService.isPro();
    if (!isPro) {
      // 2. Check Limits
      const role = await userService.getSubscriptionRole() || 'free';
      const limit = USAGE_LIMITS[role] || USAGE_LIMITS['free'];
      const currentCount = await this.getEventCount(user);

      if (currentCount >= limit) {
        throw new Error(`Upload limit reached for ${role} tier. You have ${currentCount} events. Limit is ${limit}. Please upgrade to upload more.`);
      }
    }

    // 3. Process and Compress Original Files if needed
    if (originalFiles) {
      const files = Array.isArray(originalFiles) ? originalFiles : [originalFiles];
      const textExtensions = ['gpx', 'tcx', 'json', 'sml'];
      for (const file of files) {
        // Normalize extension: strip .gz if present to check if it's a text-based file
        const extension = file.extension.toLowerCase();
        const baseExtension = extension.endsWith('.gz') ? extension.slice(0, -3) : (extension === 'gz' ? '' : extension);

        if (textExtensions.includes(baseExtension)) {
          try {
            // Check if already compressed to avoid double compression
            const isBinary = file.data instanceof ArrayBuffer || file.data instanceof Uint8Array || file.data instanceof Blob;
            let isAlreadyCompressed = false;
            if (isBinary) {
              const buffer = file.data instanceof Blob ? await file.data.arrayBuffer() : (file.data instanceof Uint8Array ? file.data.buffer : file.data);
              const bytes = new Uint8Array(buffer as ArrayBuffer);
              isAlreadyCompressed = bytes.length > 2 && bytes[0] === 0x1F && bytes[1] === 0x8B;
            }

            if (!isAlreadyCompressed) {
              this.logger.log(`[AppEventService] Compressing ${baseExtension} file`);
              if (!this.injector.get(BrowserCompatibilityService).checkCompressionSupport()) {
                this.logger.warn(`[AppEventService] Compression skipped: unsupported browser`);
                continue;
              }
              const stream = new Response(file.data as any).body.pipeThrough(new CompressionStream('gzip'));
              file.data = await new Response(stream).arrayBuffer();
            }
            file.extension = `${baseExtension}.gz`; // Ensure it always ends with .gz
          } catch (e) {
            this.logger.error(`[AppEventService] Compression failed for file, uploading uncompressed`, e);
          }
          // Check compressed size - 10MB limit (outside try-catch so errors propagate)
          const compressedSize = file.data instanceof ArrayBuffer ? file.data.byteLength : (file.data as Blob).size;
          if (compressedSize > 10 * 1024 * 1024) {
            throw new Error(`File is too large after compression (${(compressedSize / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`);
          }
        } else {
          // Non-compressible file (e.g. FIT) - check raw size
          const rawSize = file.data instanceof ArrayBuffer ? file.data.byteLength :
            (file.data instanceof Blob ? file.data.size :
              (typeof file.data === 'string' ? file.data.length : 0));
          if (rawSize > 10 * 1024 * 1024) {
            throw new Error(`File is too large (${(rawSize / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`);
          }
        }
      }
    }

    const adapter: FirestoreAdapter = {
      setDoc: (path: string[], data: any) => {
        return runInInjectionContext(this.injector, () => setDoc(doc(this.firestore, ...path as [string, ...string[]]), data));
      },
      createBlob: (data: Uint8Array) => {
        return Bytes.fromUint8Array(data);
      },
      generateID: () => {
        return runInInjectionContext(this.injector, () => doc(collection(this.firestore, 'users'))).id;
      }
    };

    const storageAdapter: StorageAdapter = {
      uploadFile: async (path: string, data: any) => {
        const fileRef = runInInjectionContext(this.injector, () => ref(this.storage, path));
        // data can be Blob, Uint8Array or ArrayBuffer. If string, convert to Blob.
        let payload = data;
        if (typeof data === 'string') {
          payload = new Blob([data], { type: 'text/plain' });
        }
        await runInInjectionContext(this.injector, () => uploadBytes(fileRef, payload));
      },
      getBucketName: () => {
        // Return the Firebase Storage bucket name from config
        return 'quantified-self-io.appspot.com';
      }
    }

    const writer = new EventWriter(adapter, storageAdapter);
    await writer.writeAllEventData(user.uid, event, originalFiles);
  }

  public async setEvent(user: User, event: EventInterface) {
    return runInInjectionContext(this.injector, () => setDoc(doc(this.firestore, 'users', user.uid, 'events', event.getID()), event.toJSON()));
  }

  public async setActivity(user: User, event: EventInterface, activity: ActivityInterface) {
    const data = activity.toJSON() as any;
    data.eventID = event.getID();
    data.userID = user.uid;
    if (event.startDate) {
      data.eventStartDate = event.startDate;
    }
    return runInInjectionContext(this.injector, () => setDoc(doc(this.firestore, 'users', user.uid, 'activities', activity.getID()), data));
  }

  public async updateEventProperties(user: User, eventID: string, propertiesToUpdate: any) {
    // @todo check if properties are allowed on object via it's JSON export interface keys
    return runInInjectionContext(this.injector, () => updateDoc(doc(this.firestore, 'users', user.uid, 'events', eventID), propertiesToUpdate));
  }

  /**
   * Deletes an event document from Firestore.
   * 
   * Note: Storage cleanup (original files) and linked activity deletion
   * are handled by the `cleanupEventFile` Cloud Function which triggers
   * on document deletion. See: functions/src/events/cleanup.ts
   */
  public async deleteAllEventData(user: User, eventID: string): Promise<boolean> {
    await runInInjectionContext(this.injector, () => deleteDoc(doc(this.firestore, 'users', user.uid, 'events', eventID)));
    return true;
  }

  public async deleteAllActivityData(user: User, eventID: string, activityID: string): Promise<boolean> {
    // @todo add try catch etc
    await this.deleteAllStreams(user, eventID, activityID);
    await runInInjectionContext(this.injector, () => deleteDoc(doc(this.firestore, 'users', user.uid, 'activities', activityID)));

    return true;
  }

  public deleteStream(user: User, eventID, activityID, streamType: string) {
    return runInInjectionContext(this.injector, () => deleteDoc(doc(this.firestore, 'users', user.uid, 'activities', activityID, 'streams', streamType)));
  }

  public async deleteAllStreams(user: User, eventID: string, activityID: string): Promise<number> {
    const streamsCollection = runInInjectionContext(this.injector, () => collection(this.firestore, 'users', user.uid, 'activities', activityID, 'streams'));
    const numberOfStreamsDeleted = await this.deleteAllDocsFromCollections([streamsCollection]);

    return numberOfStreamsDeleted
  }

  public async getEventAsJSONBloB(user: User, event: AppEventInterface): Promise<Blob> {
    const populatedEvent = await this.attachStreamsToEventWithActivities(user, event, undefined, false).pipe(take(1)).toPromise();
    const jsonString = await new EventExporterJSON().getAsString(populatedEvent);
    return (new Blob(
      [jsonString],
      { type: new EventExporterJSON().fileType },
    ));
  }

  public async getEventAsGPXBloB(user: User, event: AppEventInterface): Promise<Blob> {
    const populatedEvent = await this.attachStreamsToEventWithActivities(user, event, undefined, false, true).pipe(take(1)).toPromise();
    const gpxString = await new EventExporterGPX().getAsString(populatedEvent);
    return (new Blob(
      [gpxString],
      { type: new EventExporterGPX().fileType },
    ));
  }

  public async setEventPrivacy(user: User, eventID: string, privacy: Privacy) {
    return this.updateEventProperties(user, eventID, { privacy: privacy });
  }

  public ngOnDestroy() {
  }

  /**
   * Requires an event with activities
   * @todo this should be internal
   * @param user
   * @param event
   * @param streamTypes
   * @private
   */
  public attachStreamsToEventWithActivities(user: User, event: AppEventInterface, streamTypes?: string[], merge: boolean = true, skipEnrichment: boolean = false): Observable<EventInterface> {
    // Original File Reading Strategy:
    // ---------------------------------
    // Events store original file metadata in two fields (written by EventWriter):
    //   - originalFiles (array): Canonical source, always an array even for single files
    //   - originalFile (object): Legacy pointer to first file, for backwards compatibility
    //
    // Priority: Check originalFiles first (handles both merged events and normalized single-file cases)
    // Fallback: Check originalFile only for older events written before the normalization was added
    //
    // See EventWriter.writeAllEventData() JSDoc for the full dual-field strategy explanation.
    this.logger.log(`[AppEventService] attachStreams for ${event.getID()}. originalFile: ${!!event.originalFile}, originalFiles: ${!!event.originalFiles}`);

    // Primary path: Use originalFiles array (canonical source)
    if (event.originalFiles && event.originalFiles.length > 0) {
      this.logger.log('[AppEventService] Using client-side parsing for (Multiple)', event.getID());
      return from(this.calculateStreamsFromWithOrchestration(event, skipEnrichment)).pipe(
        map((fullEvent) => {
          if (!fullEvent) return event;

          if (merge === false) {
            // Return fresh event (disposable)
            // We need to ensure it has an ID matching the requested one for consistency, though export might not care.
            fullEvent.setID(event.getID());
            if (event.startDate) {
              // Try to preserve start date if needed
              // fullEvent.startDate = event.startDate; // EventInterface might not have setter, but let's assume it's fine
            }
            return fullEvent;
          }

          const existingID = event.getID();
          event.clearActivities();
          event.addActivities(fullEvent.getActivities());
          return event;
        }),
        catchError((e) => {
          this.logger.error('Failed to parse original files, falling back to legacy streams', e);
          return this.attachStreamsLegacy(user, event, streamTypes);
        })
      );
    }

    // Legacy fallback: Use originalFile for events written before dual-field normalization
    if (event.originalFile && event.originalFile.path) {
      this.logger.log('[AppEventService] Using client-side parsing for (Single)', event.getID());
      return from(this.calculateStreamsFromWithOrchestration(event, skipEnrichment)).pipe(
        map((fullEvent) => {
          if (!fullEvent) return event;

          if (merge === false) {
            fullEvent.setID(event.getID());
            return fullEvent;
          }

          // Merge logic: Copy activities/streams from fullEvent to event
          // We assume the file is the source of truth.
          const existingID = event.getID();
          // Keep the ID and other metadata from Firestore, but replace activities
          event.clearActivities();
          event.addActivities(fullEvent.getActivities());
          return event;
        }),
        catchError((e) => {
          this.logger.error('Failed to parse original file, falling back to legacy streams', e);
          return this.attachStreamsLegacy(user, event, streamTypes);
        })
      );
    }

    this.logger.log('[AppEventService] Fallback to legacy streams for', event.getID());
    return this.attachStreamsLegacy(user, event, streamTypes);
  }

  private attachStreamsLegacy(user: User, event: EventInterface, streamTypes?: string[]): Observable<EventInterface> {
    // Get all the streams for all activities and subscribe to them with latest emition for all streams
    return combineLatest(
      event.getActivities().map((activity) => {
        return (streamTypes ? this.getStreamsByTypes(user.uid, event.getID(), activity.getID(), streamTypes) : this.getAllStreams(user, event.getID(), activity.getID()))
          .pipe(map((streams) => {
            streams = streams || [];
            // debugger;
            // This time we dont want to just get the streams but we want to attach them to the parent obj
            activity.clearStreams();
            try {
              activity.addStreams(streams);
            } catch (e) {
              if (e.message && e.message.indexOf('Duplicate type of stream') > -1) {
                this.logger.warn('[attachStreamsLegacy] Duplicate stream warning:', e);
              } else {
                throw e;
              }
            }
            // Return what we actually want to return not the streams
            return event;
          }));
      })).pipe(map(([newEvent]) => {
        return newEvent;
      }));
  }

  private async calculateStreamsFromWithOrchestration(event: AppEventInterface, skipEnrichment: boolean = false): Promise<EventInterface> {
    this.logger.log('Calculating streams orchestration for event', event.getID());

    // 1. Array Strategy
    if (event.originalFiles && event.originalFiles.length > 0) {
      this.logger.log(`Orchestrating fetch and merge for ${event.originalFiles.length} files`);
      const promises = event.originalFiles.map(fileMeta => this.fetchAndParseOneFile(fileMeta, skipEnrichment));
      const parsedEvents = await Promise.all(promises);

      // remove nulls if any failure
      const validEvents = parsedEvents.filter(e => !!e);
      if (validEvents.length === 0) return null;

      if (validEvents.length === 1) return validEvents[0];

      const merged = EventUtilities.mergeEvents(validEvents);
      const activityIDs = new Set<string>();
      merged.getActivities().forEach((activity, index) => {
        const currentID = activity.getID();
        if (activityIDs.has(currentID)) {
          // Only append if collision detected
          activity.setID(`${currentID}_${index}`);
        }
        activityIDs.add(activity.getID());
      });
      return merged;
    }

    // 2. Legacy Single Strategy
    const originalFile = event.originalFile;
    if (!originalFile || !originalFile.path) {
      this.logger.warn('Original file path missing', originalFile);
      return null;
    }
    return this.fetchAndParseOneFile(originalFile, skipEnrichment);
  }

  public async downloadFile(path: string): Promise<ArrayBuffer> {
    const fileRef = runInInjectionContext(this.injector, () => ref(this.storage, path));
    const buffer = await runInInjectionContext(this.injector, () => getBytes(fileRef));
    return this.fileService.decompressIfNeeded(buffer, path);
  }

  private async decompressIfNeeded(buffer: ArrayBuffer, path: string): Promise<ArrayBuffer> {
    // Deprecated in favor of fileService.decompressIfNeeded, but kept for internal service stability if any call remains
    return this.fileService.decompressIfNeeded(buffer, path);
  }

  private async fetchAndParseOneFile(fileMeta: { path: string, bucket?: string }, skipEnrichment: boolean = false): Promise<EventInterface> {
    try {
      const arrayBuffer = await this.downloadFile(fileMeta.path);

      const parts = fileMeta.path.split('.');
      let extension = parts.pop()?.toLowerCase();
      if (extension === 'gz') {
        extension = parts.pop()?.toLowerCase();
      }

      let newEvent: EventInterface;

      const options = new ActivityParsingOptions({
        generateUnitStreams: false
      });

      if (extension === 'fit') {
        newEvent = await EventImporterFIT.getFromArrayBuffer(arrayBuffer, options);
      } else if (extension === 'gpx') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterGPX.getFromString(text, null, options);
      } else if (extension === 'tcx') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterTCX.getFromXML((new DOMParser()).parseFromString(text, 'application/xml'), options);
      } else if (extension === 'json') {
        const text = new TextDecoder().decode(arrayBuffer);
        const json = JSON.parse(text);
        const { sanitizedJson } = EventJSONSanitizer.sanitize(json);
        newEvent = await EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(sanitizedJson));
      } else if (extension === 'sml') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterSuuntoSML.getFromXML(text);
      } else {
        throw new Error(`Unsupported original file extension: ${extension}`);
      }

      // Polyfill Time stream if missing
      if (newEvent) {
        if (!skipEnrichment) {
          newEvent.getActivities().forEach(activity => {
            try {
              this.appEventUtilities.enrich(activity, ['Time', 'Duration']);
            } catch (e) {
              // Ignore duplicate stream errors as it means the stream already exists (possibly due to caching)
              if (e.message && e.message.indexOf('Duplicate type of stream') > -1) {
                this.logger.warn('Duplicate stream warning during enrichment:', e);
              } else {
                throw e;
              }
            }
          });
        }
      }
      return newEvent;
    } catch (e) {
      this.logger.error('Error in fetchAndParseOneFile', e);
      // throw e; // Don't throw to allow partial success in array? 
      // Actually if one fails in array, what do we do? 
      // For now, let's return null and filter it out, logging error
      return null;
    }
  }

  private _getEventActivitiesAndAllOrSomeStreams(user: User, eventID, streamTypes?: string[]) {
    return this.getEventAndActivities(user, eventID).pipe(switchMap((event) => { // Not sure about switch or merge
      if (!event) {
        return of(null);
      }
      // Get all the streams for all activities and subscribe to them with latest emition for all streams
      return this.attachStreamsToEventWithActivities(user, event, streamTypes)
    }))
  }

  private getEventsStartingAfterOrEndingBefore(user: User, getActivities: boolean, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc: EventInterface, endBeforeDoc?: EventInterface): Observable<EventInterface[]> {
    const observables: Observable<DocumentSnapshot>[] = [];
    if (startAfterDoc) {
      observables.push(
        from(runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'users', user.uid, 'events', startAfterDoc.getID()))))
      )
    }
    if (endBeforeDoc) {
      observables.push(
        from(runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'users', user.uid, 'events', endBeforeDoc.getID()))))
      )
    }
    return zip(...observables).pipe(switchMap(([resultA, resultB]) => {
      // resultA is startAfter snapshot, resultB is endBefore snapshot (if both exist) or resultA if only one exists
      // Wait, zip emits inputs in order.
      const startAfterSnap = startAfterDoc ? resultA : null;
      const endBeforeSnap = endBeforeDoc ? (startAfterDoc ? resultB : resultA) : null;

      if (startAfterDoc && endBeforeDoc) {
        return getActivities ? this._getEventsAndActivities(user, whereClauses, orderByField, asc, limitCount, startAfterSnap, endBeforeSnap) : this._getEvents(user, whereClauses, orderByField, asc, limitCount, startAfterSnap, endBeforeSnap);
      }
      // If only start after
      if (startAfterDoc) {
        return getActivities ? this._getEventsAndActivities(user, whereClauses, orderByField, asc, limitCount, startAfterSnap) : this._getEvents(user, whereClauses, orderByField, asc, limitCount, startAfterSnap);
      }
      // If only endAt
      return getActivities ? this._getEventsAndActivities(user, whereClauses, orderByField, asc, limitCount, null, endBeforeSnap) : this._getEvents(user, whereClauses, orderByField, asc, limitCount, null, endBeforeSnap);
    }));
  }

  private _getEvents(user: User, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc?: any, endBeforeDoc?: any): Observable<EventInterface[]> {
    const q = this.getEventQueryForUser(user, whereClauses, orderByField, asc, limitCount, startAfterDoc, endBeforeDoc);

    return runInInjectionContext(this.injector, () => collectionData(q, { idField: 'id' })).pipe(map((eventSnapshots: any[]) => {
      return eventSnapshots.map((eventSnapshot) => {
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(eventSnapshot);
        if (unknownTypes.length > 0) {
          const newUnknownTypes = unknownTypes.filter(type => !AppEventService.reportedUnknownTypes.has(type));
          if (newUnknownTypes.length > 0) {
            newUnknownTypes.forEach(type => AppEventService.reportedUnknownTypes.add(type));
            this.logger.captureMessage('Unknown Data Types in _getEvents', { extra: { types: newUnknownTypes, eventID: eventSnapshot.id } });
          }
        }
        const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(eventSnapshot.id) as AppEventInterface;

        // Hydrate with original file(s) info if present
        const rawData = eventSnapshot as any;

        if (rawData.originalFiles) {
          event.originalFiles = rawData.originalFiles;
        }
        if (rawData.originalFile) {
          event.originalFile = rawData.originalFile;
        }

        return event;
      })
    }));
  }

  private _getEventsAndActivities(user: User, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc?: any, endBeforeDoc?: any): Observable<EventInterface[]> {
    const q = this.getEventQueryForUser(user, whereClauses, orderByField, asc, limitCount, startAfterDoc, endBeforeDoc);

    return runInInjectionContext(this.injector, () => collectionData(q, { idField: 'id' })).pipe(map((eventSnapshots: any[]) => {
      return eventSnapshots.reduce((events: EventInterface[], eventSnapshot) => {
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(eventSnapshot);
        if (unknownTypes.length > 0) {
          const newUnknownTypes = unknownTypes.filter(type => !AppEventService.reportedUnknownTypes.has(type));
          if (newUnknownTypes.length > 0) {
            newUnknownTypes.forEach(type => AppEventService.reportedUnknownTypes.add(type));
            this.logger.captureMessage('Unknown Data Types in _getEventsAndActivities', { extra: { types: newUnknownTypes, eventID: eventSnapshot.id } });
          }
        }
        const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(eventSnapshot.id) as AppEventInterface;

        // Hydrate with original file(s) info if present
        const rawData = eventSnapshot as any;

        if (rawData.originalFiles) {
          event.originalFiles = rawData.originalFiles;
        }
        if (rawData.originalFile) {
          event.originalFile = rawData.originalFile;
        }

        events.push(event);
        return events;
      }, []);
    })).pipe(switchMap((events: EventInterface[]) => {
      if (events.length === 0) {
        return of([]);
      }
      return combineLatest(events.map((event) => {
        return this.getActivities(user, event.getID()).pipe(map((activities) => {
          event.addActivities(activities)
          return event;
        }));
      }))
    }));
  }

  private getEventQueryForUser(user: User, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc?: any, endBeforeDoc?: any) {
    return runInInjectionContext(this.injector, () => {
      const eventsRef = collection(this.firestore, `users/${user.uid}/events`);
      const constraints: any[] = [];

      // Replicate legacy logic for startDate ordering when filtering
      if (whereClauses.length) {
        whereClauses.forEach(clause => {
          if (clause.fieldPath === 'startDate' && (orderByField !== 'startDate')) {
            constraints.push(orderBy('startDate', 'asc'));
          }
        });
      }

      // Main Sort
      constraints.push(orderBy(orderByField, asc ? 'asc' : 'desc'));

      // Filters
      whereClauses.forEach(clause => {
        constraints.push(where(clause.fieldPath, clause.opStr, clause.value));
      });

      if (limitCount > 0) {
        constraints.push(limit(limitCount));
      }
      if (startAfterDoc) {
        constraints.push(startAfter(startAfterDoc));
      }
      if (endBeforeDoc) {
        constraints.push(endBefore(endBeforeDoc));
      }

      return query(eventsRef, ...constraints);
    });
  }

  // Legacy method kept for other consumers if any (though _getEvents was main one)
  // DEPRECATED and likely broken in original but ported best-effort
  /*
  private getEventCollectionForUser(user: User, where: { fieldPath: string | any, opStr: any, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: any, endBefore?: any) {
    // ... logic was mixed with query building in Compat.
    // In modular, we just return Query.
    return this.getEventQueryForUser(user, where, orderBy, asc, limit, startAfter, endBefore);
  }
  */

  private processStreamDocumentSnapshot(streamSnapshot: DocumentSnapshot): StreamInterface {
    return EventImporterJSON.getStreamFromJSON(<any>streamSnapshot.data());
  }

  private processStreamQueryDocumentSnapshot(queryDocumentSnapshot: QueryDocumentSnapshot): StreamInterface {
    return EventImporterJSON.getStreamFromJSON(<any>queryDocumentSnapshot.data());
  }

  // From https://github.com/angular/angularfire2/issues/1400
  private async deleteAllDocsFromCollections(collections: CollectionReference[]) {
    let totalDeleteCount = 0;
    const batchSize = 500;
    // Iterate collections
    for (const coll of collections) {
      const snaps = await runInInjectionContext(this.injector, () => getDocs(coll)); // Read all
      // Batch delete
      const chunks = this.chunkArray(snaps.docs, batchSize);
      for (const chunk of chunks) {
        const batch = runInInjectionContext(this.injector, () => writeBatch(this.firestore));
        chunk.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        totalDeleteCount += chunk.length;
      }
    }
    return totalDeleteCount;
  }

  private chunkArray(myArray, chunk_size) {
    const results = [];
    while (myArray.length) {
      results.push(myArray.splice(0, chunk_size));
    }
    return results;
  }
  /**
   * Uses Firestore Aggregation Queries to count events efficiently.
   *
   * Cost Efficiency:
   * - Does NOT read actual documents, only scans the index.
   * - Cost is 1 document read per 1,000 index entries.
   * - Example: 5,000 events = 5 billable reads.
   *
   * @todo Cache this result (e.g., in a Signal or BehaviorSubject) to avoid unnecessary server calls on every navigation.
   */
  public async getEventCount(user: User): Promise<number> {
    const eventsRef = runInInjectionContext(this.injector, () => collection(this.firestore, `users/${user.uid}/events`));
    const snapshot = await runInInjectionContext(this.injector, () => getCountFromServer(query(eventsRef)));
    return snapshot.data().count;
  }
}
