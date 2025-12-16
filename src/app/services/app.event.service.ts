import { inject, Injectable, OnDestroy } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { EventImporterJSON } from '@sports-alliance/sports-lib';
import { combineLatest, from, Observable, Observer, of, zip } from 'rxjs';
import { Firestore, collection, query, orderBy, where, limit, startAfter, endBefore, collectionData, doc, docData, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, DocumentSnapshot, QueryDocumentSnapshot, DocumentData, CollectionReference } from '@angular/fire/firestore';
import { bufferCount, catchError, concatMap, map, switchMap, take } from 'rxjs/operators';
import { EventJSONInterface } from '@sports-alliance/sports-lib';
import { ActivityJSONInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { StreamInterface } from '@sports-alliance/sports-lib';
import * as Sentry from '@sentry/browser';
import { EventExporterJSON } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { Privacy } from '@sports-alliance/sports-lib';
import { AppWindowService } from './app.window.service';
import {
  EventMetaDataInterface,
  ServiceNames
} from '@sports-alliance/sports-lib';
import { EventExporterGPX } from '@sports-alliance/sports-lib';
import { StreamEncoder } from '../helpers/stream.encoder';
import { CompressedJSONStreamInterface } from '@sports-alliance/sports-lib';
import { EventWriter, FirestoreAdapter, StorageAdapter } from '../../../functions/src/shared/event-writer';
import { Bytes } from 'firebase/firestore';
import { Storage, ref, uploadBytes, getBytes } from '@angular/fire/storage';
import { EventImporterSuuntoJSON } from '@sports-alliance/sports-lib';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { EventImporterTCX } from '@sports-alliance/sports-lib';
import { EventImporterGPX } from '@sports-alliance/sports-lib';
import { EventImporterSuuntoSML } from '@sports-alliance/sports-lib';


import { EventJSONSanitizer } from '../utils/event-json-sanitizer';

@Injectable({
  providedIn: 'root',
})
export class AppEventService implements OnDestroy {

  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private static reportedUnknownTypes = new Set<string>();

  constructor(
    private windowService: AppWindowService) {
  }

  public getEventAndActivities(user: User, eventID: string): Observable<EventInterface> {
    // See
    // https://stackoverflow.com/questions/42939978/avoiding-nested-subscribes-with-combine-latest-when-one-observable-depends-on-th
    const eventDoc = doc(this.firestore, 'users', user.uid, 'events', eventID);
    return combineLatest([
      docData(eventDoc).pipe(
        map(eventSnapshot => {
          if (!eventSnapshot) return null;
          console.log('[AppEventService] getEventAndActivities snapshot:', JSON.stringify(eventSnapshot));
          const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(eventSnapshot);
          if (unknownTypes.length > 0) {
            const newUnknownTypes = unknownTypes.filter(type => !AppEventService.reportedUnknownTypes.has(type));
            if (newUnknownTypes.length > 0) {
              newUnknownTypes.forEach(type => AppEventService.reportedUnknownTypes.add(type));
              Sentry.captureMessage('Unknown Data Types in getEventAndActivities', { extra: { types: newUnknownTypes, eventID } });
            }
          }
          const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(eventID);
          if ((eventSnapshot as any).originalFile) {
            Object.assign(event, { originalFile: (eventSnapshot as any).originalFile });
            console.log('[AppEventService] Patch applied in getEventAndActivities for', eventID, 'Has it?', !!(event as any).originalFile);
          }
          return event;
        })),
      this.getActivities(user, eventID),
    ]).pipe(catchError((error) => {
      if (error && error.code && error.code === 'permission-denied') {
        return of([null, null] as [EventInterface | null, ActivityInterface[] | null]);
      }
      console.error('Error fetching event or activities:', error);
      Sentry.captureException(error);

      return of([null, null] as [EventInterface | null, ActivityInterface[] | null]); // @todo fix this
    })).pipe(map(([event, activities]: [EventInterface, ActivityInterface[]]) => {
      if (!event) {
        return null;
      }
      event.clearActivities();
      event.addActivities(activities);
      return event;
    })).pipe(catchError((error) => {
      // debugger;
      console.error('Error adding activities to event:', error);
      Sentry.captureException(error);

      return of(null); // @todo is this the best we can do?
    }))
  }

  public getEventsBy(user: User, where: { fieldPath: string | any, opStr: any, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    if (startAfter || endBefore) {
      return this.getEventsStartingAfterOrEndingBefore(user, false, where, orderBy, asc, limit, startAfter, endBefore);
    }
    return this._getEvents(user, where, orderBy, asc, limit);
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
    const activitiesCollection = collection(this.firestore, 'users', user.uid, 'events', eventID, 'activities');
    return (collectionData(activitiesCollection, { idField: 'id' }) as Observable<any[]>).pipe(
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
                Sentry.captureMessage('Unknown Data Types in getActivities', { extra: { types: newUnknownTypes, eventID, activityID: activitySnapshot.id } });
              }
            }
            activitiesArray.push(EventImporterJSON.getActivityFromJSON(<ActivityJSONInterface>sanitizedJson).setID(activitySnapshot.id));
          } catch (e) {
            console.error('Failed to parse activity:', activitySnapshot.id, 'Error:', e);
          }
          return activitiesArray;
        }, []);
      }),
    )
  }

  public getEventMetaData(user: User, eventID: string, serviceName: ServiceNames): Observable<EventMetaDataInterface> {
    const metaDataDoc = doc(this.firestore, 'users', user.uid, 'events', eventID, 'metaData', serviceName);
    return docData(metaDataDoc).pipe(
      map(metaDataSnapshot => {
        return <EventMetaDataInterface>metaDataSnapshot;
      }),
    )
  }

  public getAllStreams(user: User, eventID: string, activityID: string): Observable<StreamInterface[]> {
    const streamsCollection = collection(this.firestore, 'users', user.uid, 'events', eventID, 'activities', activityID, 'streams');
    return from(getDocs(streamsCollection)) // @todo replace with snapshot changes I suppose when @https://github.com/angular/angularfire2/issues/1552 is fixed
      .pipe(map((querySnapshot) => {
        return querySnapshot.docs.map(queryDocumentSnapshot => this.processStreamQueryDocumentSnapshot(queryDocumentSnapshot))
      }))
  }

  public getStream(user: User, eventID: string, activityID: string, streamType: string): Observable<StreamInterface> {
    const streamDoc = doc(this.firestore, 'users', user.uid, 'events', eventID, 'activities', activityID, 'streams', streamType);
    return from(getDoc(streamDoc)) // @todo replace with snapshot changes I suppose when @https://github.com/angular/angularfire2/issues/1552 is fixed
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
      const streamsCollection = collection(this.firestore, 'users', userID, 'events', eventID, 'activities', activityID, 'streams');
      const q = query(streamsCollection, where('type', 'in', typesBatch));
      return from(getDocs(q))
        .pipe(map((documentSnapshots) => {
          return documentSnapshots.docs.reduce((streamArray: StreamInterface[], documentSnapshot) => {
            streamArray.push(this.processStreamDocumentSnapshot(documentSnapshot));
            return streamArray;
          }, []);
        }))
    })

    return combineLatest(x).pipe(map(arrayOfArrays => arrayOfArrays.reduce((a, b) => a.concat(b), [])));
  }

  public async writeAllEventData(user: User, event: EventInterface, originalFile?: { data: any, extension: string }) {
    const adapter: FirestoreAdapter = {
      setDoc: (path: string[], data: any) => {
        // Construct the full path from the array parts
        // The first part is 'users', then uid, etc.
        // path example: ['users', userID, 'events', eventID]
        // collection(firestore, path[0], path[1], ...) seems wrong if it mixes coll/doc
        // doc() takes (firestore, path...)
        return setDoc(doc(this.firestore, ...path as [string, ...string[]]), data);
      },
      createBlob: (data: Uint8Array) => {
        return Bytes.fromUint8Array(data);
      },
      generateID: () => {
        return doc(collection(this.firestore, 'users')).id;
      }
    };

    const storageAdapter: StorageAdapter = {
      uploadFile: async (path: string, data: any) => {
        const fileRef = ref(this.storage, path);
        // data can be Blob, Uint8Array or ArrayBuffer. If string, convert to Blob.
        let payload = data;
        if (typeof data === 'string') {
          payload = new Blob([data], { type: 'text/plain' });
        }
        await uploadBytes(fileRef, payload);
      },
      getBucketName: () => {
        // Return the Firebase Storage bucket name from config
        return 'quantified-self-io.appspot.com';
      }
    }

    const writer = new EventWriter(adapter, storageAdapter);
    await writer.writeAllEventData(user.uid, event, originalFile);
  }

  public async setEvent(user: User, event: EventInterface) {
    return setDoc(doc(this.firestore, 'users', user.uid, 'events', event.getID()), event.toJSON());
  }

  public async setActivity(user: User, event: EventInterface, activity: ActivityInterface) {
    return setDoc(doc(this.firestore, 'users', user.uid, 'events', event.getID(), 'activities', activity.getID()), activity.toJSON());
  }

  public async updateEventProperties(user: User, eventID: string, propertiesToUpdate: any) {
    // @todo check if properties are allowed on object via it's JSON export interface keys
    return updateDoc(doc(this.firestore, 'users', user.uid, 'events', eventID), propertiesToUpdate);
  }

  public async deleteAllEventData(user: User, eventID: string): Promise<boolean> {
    await deleteDoc(doc(this.firestore, 'users', user.uid, 'events', eventID));
    return true;
  }

  public async getEventAsJSONBloB(user: User, eventID: string): Promise<Blob> {
    const jsonString = await new EventExporterJSON().getAsString(await this.getEventActivitiesAndAllStreams(user, eventID).pipe(take(1)).toPromise());
    return (new Blob(
      [jsonString],
      { type: new EventExporterJSON().fileType },
    ));
  }

  public async getEventAsGPXBloB(user: User, eventID: string): Promise<Blob> {
    const gpxString = await new EventExporterGPX().getAsString(await this.getEventActivitiesAndAllStreams(user, eventID).pipe(take(1)).toPromise());
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
  public attachStreamsToEventWithActivities(user: User, event: EventInterface, streamTypes?: string[]): Observable<EventInterface> {
    // Check if we have an original file to parse instead of fetching from Firestore
    console.log(`[AppEventService] attachStreams for ${event.getID()}. Has originalFile?`, !!(event as any).originalFile);
    console.log(`[AppEventService] attachStreams for ${event.getID()}. Has originalFile?`, !!(event as any).originalFile);
    console.log('[AppEventService] Event props:', JSON.stringify(event));
    console.log('[AppEventService] Event keys:', Object.keys(event));
    console.log('[AppEventService] originalFile via bracket:', (event as any)['originalFile']);
    console.log('[AppEventService] originalFile descriptor:', Object.getOwnPropertyDescriptor(event, 'originalFile'));

    if ((event as any).originalFile && (event as any).originalFile.path) {
      console.log('[AppEventService] Using client-side parsing for', event.getID());
      return from(this.caclulateStreamsFromOriginalFile(event)).pipe(
        map((fullEvent) => {
          if (!fullEvent) return event;
          // Merge logic: Copy activities/streams from fullEvent to event
          // We assume the file is the source of truth.
          const existingID = event.getID();
          // Keep the ID and other metadata from Firestore, but replace activities
          event.clearActivities();
          event.addActivities(fullEvent.getActivities());
          return event;
        }),
        catchError((e) => {
          console.error('Failed to parse original file, falling back to legacy streams', e);
          return this.attachStreamsLegacy(user, event, streamTypes);
        })
      );
    }

    console.log('[AppEventService] Fallback to legacy streams for', event.getID());
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
            activity.addStreams(streams);
            // Return what we actually want to return not the streams
            return event;
          }));
      })).pipe(map(([newEvent]) => {
        return newEvent;
      }));
  }

  private async caclulateStreamsFromOriginalFile(event: EventInterface): Promise<EventInterface> {
    console.log('Calculating streams from original file for event', event.getID());
    const originalFile = (event as any).originalFile;
    if (!originalFile || !originalFile.path) {
      console.warn('Original file path missing', originalFile);
      return null;
    }

    try {
      const fileRef = ref(this.storage, originalFile.path);
      console.log('Fetching file bytes from', originalFile.path);
      const arrayBuffer = await getBytes(fileRef);
      console.log('File bytes fetched, size:', arrayBuffer.byteLength);

      // Determine extension. using path or explicit extension if we had it
      // path is user/uid/events/id/original.fit
      const parts = originalFile.path.split('.');
      const extension = parts[parts.length - 1].toLowerCase();
      console.log('Parsing file with extension:', extension);

      let newEvent: EventInterface;

      if (extension === 'fit') {
        newEvent = await EventImporterFIT.getFromArrayBuffer(arrayBuffer);
      } else if (extension === 'gpx') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterGPX.getFromString(text);
      } else if (extension === 'tcx') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterTCX.getFromXML((new DOMParser()).parseFromString(text, 'application/xml'));
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
      console.log('File parsed successfully');
      return newEvent;
    } catch (e) {
      console.error('Error in caclulateStreamsFromOriginalFile', e);
      throw e;
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
        from(getDoc(doc(this.firestore, 'users', user.uid, 'events', startAfterDoc.getID())))
      )
    }
    if (endBeforeDoc) {
      observables.push(
        from(getDoc(doc(this.firestore, 'users', user.uid, 'events', endBeforeDoc.getID())))
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

    return collectionData(q, { idField: 'id' }).pipe(map((eventSnapshots: any[]) => {
      return eventSnapshots.map((eventSnapshot) => {
        console.log('[AppEventService] _getEvents snapshot:', JSON.stringify(eventSnapshot));
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(eventSnapshot);
        if (unknownTypes.length > 0) {
          const newUnknownTypes = unknownTypes.filter(type => !AppEventService.reportedUnknownTypes.has(type));
          if (newUnknownTypes.length > 0) {
            newUnknownTypes.forEach(type => AppEventService.reportedUnknownTypes.add(type));
            Sentry.captureMessage('Unknown Data Types in _getEvents', { extra: { types: newUnknownTypes, eventID: eventSnapshot.id } });
          }
        }
        const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(eventSnapshot.id);
        if ((eventSnapshot as any).originalFile) {
          // Force assignment using Object.assign or defineProperty in case of sealed keys?
          // (event as any).originalFile = (eventSnapshot as any).originalFile;
          Object.assign(event, { originalFile: (eventSnapshot as any).originalFile });
          console.log('[AppEventService] Patch applied in _getEvents for', eventSnapshot.id, 'Has it?', !!(event as any).originalFile);
        }
        return event;
      })
    }));
  }

  private _getEventsAndActivities(user: User, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc?: any, endBeforeDoc?: any): Observable<EventInterface[]> {
    const q = this.getEventQueryForUser(user, whereClauses, orderByField, asc, limitCount, startAfterDoc, endBeforeDoc);

    return collectionData(q, { idField: 'id' }).pipe(map((eventSnapshots: any[]) => {
      return eventSnapshots.reduce((events: EventInterface[], eventSnapshot) => {
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(eventSnapshot);
        if (unknownTypes.length > 0) {
          const newUnknownTypes = unknownTypes.filter(type => !AppEventService.reportedUnknownTypes.has(type));
          if (newUnknownTypes.length > 0) {
            newUnknownTypes.forEach(type => AppEventService.reportedUnknownTypes.add(type));
            Sentry.captureMessage('Unknown Data Types in _getEventsAndActivities', { extra: { types: newUnknownTypes, eventID: eventSnapshot.id } });
          }
        }
        const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(eventSnapshot.id);
        if ((eventSnapshot as any).originalFile) {
          Object.assign(event, { originalFile: (eventSnapshot as any).originalFile });
          console.log('[AppEventService] Patch applied in _getEvents for', eventSnapshot.id, 'Has it?', !!(event as any).originalFile);
        }
        events.push(event);
        return events;
      }, []);
    })).pipe(switchMap((events: EventInterface[]) => {
      console.log('[AppEventService] _getEventsAndActivities events:', events.length);
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
    return EventImporterJSON.getStreamFromJSON(StreamEncoder.decompressStream(<CompressedJSONStreamInterface>streamSnapshot.data()));
  }

  private processStreamQueryDocumentSnapshot(queryDocumentSnapshot: QueryDocumentSnapshot): StreamInterface {
    return EventImporterJSON.getStreamFromJSON(StreamEncoder.decompressStream(<CompressedJSONStreamInterface>queryDocumentSnapshot.data()));
  }

  // From https://github.com/angular/angularfire2/issues/1400
  private async deleteAllDocsFromCollections(collections: CollectionReference[]) {
    let totalDeleteCount = 0;
    const batchSize = 500;
    // Iterate collections
    for (const coll of collections) {
      const snaps = await getDocs(coll); // Read all
      // Batch delete
      const chunks = this.chunkArray(snaps.docs, batchSize);
      for (const chunk of chunks) {
        const batch = writeBatch(this.firestore);
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
}

