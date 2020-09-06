import { Injectable, OnDestroy } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { EventImporterJSON } from '@sports-alliance/sports-lib/lib/events/adapters/importers/json/importer.json';
import { combineLatest, from, Observable, Observer, of, zip } from 'rxjs';
import { AngularFirestore, AngularFirestoreCollection, } from '@angular/fire/firestore';
import { bufferCount, catchError, concatMap, map, switchMap, take } from 'rxjs/operators';
import { firestore } from 'firebase/app';
import * as Pako from 'pako';
import { EventJSONInterface } from '@sports-alliance/sports-lib/lib/events/event.json.interface';
import { ActivityJSONInterface } from '@sports-alliance/sports-lib/lib/activities/activity.json.interface';
import { ActivityInterface } from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import { StreamInterface } from '@sports-alliance/sports-lib/lib/streams/stream.interface';
import { Log } from 'ng2-logger/browser';
import * as Sentry from '@sentry/browser';
import { fromPromise } from 'rxjs/internal-compatibility';
import { EventExporterJSON } from '@sports-alliance/sports-lib/lib/events/adapters/exporters/exporter.json';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { Privacy } from '@sports-alliance/sports-lib/lib/privacy/privacy.class.interface';
import { AppWindowService } from './app.window.service';
import { gzip_decode } from 'wasm-flate';
import {
  EventMetaDataInterface,
  ServiceNames
} from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { EventExporterGPX } from '@sports-alliance/sports-lib/lib/events/adapters/exporters/exporter.gpx';
import { getSize, getSizeFormated } from '@sports-alliance/sports-lib/lib/events/utilities/helpers';
import {
  CompressedJSONStreamInterface,
  CompressionEncodings,
  CompressionMethods
} from '../../../../sports-lib/src/streams/compressed.json.stream.interface';
import * as LZString from 'lz-string';
import { StreamJSONInterface } from '@sports-alliance/sports-lib/lib/streams/stream';
import DocumentData = firebase.firestore.DocumentData;


@Injectable({
  providedIn: 'root',
})
export class AppEventService implements OnDestroy {

  protected logger = Log.create('EventService');

  constructor(
    private windowService: AppWindowService,
    private afs: AngularFirestore) {
  }

  public getEventAndActivities(user: User, eventID: string): Observable<EventInterface> {
    // See
    // https://stackoverflow.com/questions/42939978/avoiding-nested-subscribes-with-combine-latest-when-one-observable-depends-on-th
    return combineLatest(
      this.afs
        .collection('users')
        .doc(user.uid)
        .collection('events').doc(eventID).snapshotChanges().pipe(
        map(eventSnapshot => {
          return eventSnapshot.payload.exists ? EventImporterJSON.getEventFromJSON(<EventJSONInterface>eventSnapshot.payload.data()).setID(eventID) : null;
        })),
      this.getActivities(user, eventID),
    ).pipe(catchError((error) => {
      if (error && error.code && error.code === 'permission-denied') {
        return of([null, null])
      }
      Sentry.captureException(error);
      this.logger.error(error);
      return of([null, null]) // @todo fix this
    })).pipe(map(([event, activities]: [EventInterface, ActivityInterface[]]) => {
      if (!event) {
        return null;
      }
      event.clearActivities();
      event.addActivities(activities);
      return event;
    })).pipe(catchError((error) => {
      // debugger;
      Sentry.captureException(error);
      this.logger.error(error);
      return of(null); // @todo is this the best we can do?
    }))
  }

  public getEventsBy(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    if (startAfter || endBefore) {
      return this.getEventsStartingAfterOrEndingBefore(user, false, where, orderBy, asc, limit, startAfter, endBefore);
    }
    return this._getEvents(user, where, orderBy, asc, limit);
  }

  public getEventsAndActivitiesBy(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
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
  public getEventActivitiesAndSomeStreams(user: User, eventID, streamTypes: string[]) {
    return this._getEventActivitiesAndAllOrSomeStreams(user, eventID, streamTypes);
  }

  /**
   * Get's the event, activities and all available streams
   * @param user
   * @param eventID
   */
  public getEventActivitiesAndAllStreams(user: User, eventID) {
    return this._getEventActivitiesAndAllOrSomeStreams(user, eventID);
  }

  public getActivities(user: User, eventID: string): Observable<ActivityInterface[]> {
    return this.afs
      .collection('users')
      .doc(user.uid)
      .collection('events').doc(eventID).collection('activities')
      .snapshotChanges().pipe(
        map(activitySnapshots => {
          return activitySnapshots.reduce((activitiesArray: ActivityInterface[], activitySnapshot) => {
            activitiesArray.push(EventImporterJSON.getActivityFromJSON(<ActivityJSONInterface>activitySnapshot.payload.doc.data()).setID(activitySnapshot.payload.doc.id));
            return activitiesArray;
          }, []);
        }),
      )
  }

  public getEventMetaData(user: User, eventID: string, serviceName: ServiceNames): Observable<EventMetaDataInterface> {
    return this.afs
      .collection('users')
      .doc(user.uid)
      .collection('events')
      .doc(eventID)
      .collection('metaData')
      .doc(serviceName)
      .snapshotChanges().pipe(
        map(metaDataSnapshot => {
          return <EventMetaDataInterface>metaDataSnapshot.payload.data();
        }),
      )
  }

  public getAllStreams(user: User, eventID: string, activityID: string): Observable<StreamInterface[]> {
    return this.afs
      .collection('users')
      .doc(user.uid)
      .collection('events')
      .doc(eventID)
      .collection('activities')
      .doc(activityID)
      .collection('streams')
      .get() // @todo replace with snapshot changes I suppose when @https://github.com/angular/angularfire2/issues/1552 is fixed
      .pipe(map((querySnapshot) => {
        return querySnapshot.docs.map(queryDocumentSnapshot => this.processStreamQueryDocumentSnapshot(queryDocumentSnapshot))
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
      return this.afs
        .collection('users')
        .doc(userID)
        .collection('events')
        .doc(eventID)
        .collection('activities')
        .doc(activityID)
        .collection('streams', ((ref) => {
          return ref.where('type', 'in', typesBatch);
        }))
        .get()
        .pipe(map((documentSnapshots) => {
          return documentSnapshots.docs.reduce((streamArray: StreamInterface[], documentSnapshot) => {
            streamArray.push(this.processStreamDocumentSnapshot(documentSnapshot));
            return streamArray;
          }, []);
        }))
    })

    return combineLatest(x).pipe(map(arrayOfArrays => arrayOfArrays.reduce((a, b) => a.concat(b), [])));
  }

  public async writeAllEventData(user: User, event: EventInterface) {
    const writePromises: Promise<void>[] = [];
    event.setID(event.getID() || this.afs.createId());
    event.getActivities()
      .forEach((activity) => {
        activity.setID(activity.getID() || this.afs.createId());

        writePromises.push(
          this.afs.collection('users')
            .doc(user.uid)
            .collection('events')
            .doc(event.getID())
            .collection('activities')
            .doc(activity.getID())
            .set(activity.toJSON()));

        activity.getAllExportableStreams().forEach((stream) => {
          writePromises.push(this.afs
            .collection('users')
            .doc(user.uid)
            .collection('events')
            .doc(event.getID())
            .collection('activities')
            .doc(activity.getID())
            .collection('streams')
            .doc(stream.type)
            .set(this.getCompressedStreamFromStream(stream)))
        });
      });
    try {
      await Promise.all(writePromises);
      return this.afs.collection('users').doc(user.uid).collection('events').doc(event.getID()).set(event.toJSON());
    } catch (e) {
      this.logger.error(e);
      // Try to delete the parent entity and all subdata
      await this.deleteAllEventData(user, event.getID());
      throw new Error('Could not parse event');
    }
  }

  public async setEvent(user: User, event: EventInterface) {
    return this.afs.collection('users').doc(user.uid).collection('events').doc(event.getID()).set(event.toJSON());
  }

  public async setActivity(user: User, event: EventInterface, activity: ActivityInterface) {
    return this.afs.collection('users').doc(user.uid).collection('events').doc(event.getID()).collection('activities').doc(activity.getID()).set(activity.toJSON());
  }

  public async updateEventProperties(user: User, eventID: string, propertiesToUpdate: any) {
    // @todo check if properties are allowed on object via it's JSON export interface keys
    return this.afs.collection('users').doc(user.uid).collection('events').doc(eventID).update(propertiesToUpdate);
  }

  public async deleteAllEventData(user: User, eventID: string): Promise<boolean> {
    const activityDeletePromises: Promise<boolean>[] = [];
    const queryDocumentSnapshots = await this.afs
      .collection('users')
      .doc(user.uid)
      .collection('events')
      .doc(eventID).collection('activities').ref.get();
    queryDocumentSnapshots.docs.forEach((queryDocumentSnapshot) => {
      activityDeletePromises.push(this.deleteAllActivityData(user, eventID, queryDocumentSnapshot.id))
    });
    await this.afs
      .collection('users')
      .doc(user.uid)
      .collection('events')
      .doc(eventID).delete();
    this.logger.info(`Deleted event ${eventID}`);
    await Promise.all(activityDeletePromises);
    return true;
  }

  public async deleteAllActivityData(user: User, eventID: string, activityID: string): Promise<boolean> {
    // @todo add try catch etc
    await this.deleteAllStreams(user, eventID, activityID);
    await this.afs
      .collection('users')
      .doc(user.uid)
      .collection('events')
      .doc(eventID)
      .collection('activities')
      .doc(activityID).delete();
    this.logger.info(`Deleted activity ${activityID} for event ${eventID}`);
    return true;
  }

  public deleteStream(user: User, eventID, activityID, streamType: string) {
    return this.afs.collection('users').doc(user.uid).collection('events').doc(eventID).collection('activities').doc(activityID).collection('streams').doc(streamType).delete();
  }

  public async deleteAllStreams(user: User, eventID, activityID): Promise<number> {
    const numberOfStreamsDeleted = await this.deleteAllDocsFromCollections([
      this.afs.collection('users').doc(user.uid).collection('events').doc(eventID).collection('activities').doc(activityID).collection('streams'),
    ]);
    this.logger.info(`Deleted ${numberOfStreamsDeleted} streams for event: ${eventID} and activity ${activityID}`);
    return numberOfStreamsDeleted
  }

  public async getEventAsJSONBloB(user: User, eventID: string): Promise<Blob> {
    const jsonString = await new EventExporterJSON().getAsString(await this.getEventActivitiesAndAllStreams(user, eventID).pipe(take(1)).toPromise());
    return (new Blob(
      [jsonString],
      {type: new EventExporterJSON().fileType},
    ));
  }

  public async getEventAsGPXBloB(user: User, eventID: string): Promise<Blob> {
    const gpxString = await new EventExporterGPX().getAsString(await this.getEventActivitiesAndAllStreams(user, eventID).pipe(take(1)).toPromise());
    return (new Blob(
      [gpxString],
      {type: new EventExporterGPX().fileType},
    ));
  }

  public async setEventPrivacy(user: User, eventID: string, privacy: Privacy) {
    return this.updateEventProperties(user, eventID, {privacy: privacy});
  }

  public ngOnDestroy() {
  }

  private _getEventActivitiesAndAllOrSomeStreams(user: User, eventID, streamTypes?: string[]) {
    return this.getEventAndActivities(user, eventID).pipe(switchMap((event) => { // Not sure about switch or merge
      if (!event) {
        return of([]);
      }
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
        }));
    })).pipe(map(([event]) => {
      // debugger;
      return event;
    }))
  }

  private getEventsStartingAfterOrEndingBefore(user: User, getActivities: boolean, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    const observables: Observable<firestore.DocumentSnapshot>[] = [];
    if (startAfter) {
      observables.push(this.afs
        .collection('users')
        .doc(user.uid)
        .collection('events')
        .doc(startAfter.getID()).get()
        .pipe(take(1)))
    }
    if (endBefore) {
      observables.push(this.afs
        .collection('users')
        .doc(user.uid)
        .collection('events')
        .doc(endBefore.getID()).get()
        .pipe(take(1)))
    }
    return zip(...observables).pipe(switchMap(([resultA, resultB]) => {
      if (startAfter && endBefore) {
        return getActivities ? this._getEventsAndActivities(user, where, orderBy, asc, limit, resultA, resultB) : this._getEvents(user, where, orderBy, asc, limit, resultA, resultB);
      }
      // If only start after
      if (startAfter) {
        return getActivities ? this._getEventsAndActivities(user, where, orderBy, asc, limit, resultA) : this._getEvents(user, where, orderBy, asc, limit, resultA);
      }
      // If only endAt
      return getActivities ? this._getEventsAndActivities(user, where, orderBy, asc, limit, null, resultA) : this._getEvents(user, where, orderBy, asc, limit, null, resultA);
    }));
  }

  private _getEvents(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: firestore.DocumentSnapshot, endBefore?: firestore.DocumentSnapshot): Observable<EventInterface[]> {
    return this.getEventCollectionForUser(user, where, orderBy, asc, limit, startAfter, endBefore)
      .snapshotChanges().pipe(map((eventSnapshots) => {
        return eventSnapshots.map((eventSnapshot) => {
          return eventSnapshot.payload.doc.exists ? EventImporterJSON.getEventFromJSON(<EventJSONInterface>eventSnapshot.payload.doc.data()).setID(eventSnapshot.payload.doc.id) : null;
        })
      }))
  }

  private _getEventsAndActivities(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: firestore.DocumentSnapshot, endBefore?: firestore.DocumentSnapshot): Observable<EventInterface[]> {
    return this.getEventCollectionForUser(user, where, orderBy, asc, limit, startAfter, endBefore)
      .snapshotChanges().pipe(map((eventSnapshots) => {
        return eventSnapshots.reduce((eventIDS, eventSnapshot) => {
          eventIDS.push(eventSnapshot.payload.doc.id);
          return eventIDS;
        }, []);
      })).pipe(switchMap((eventIDS) => {
        // debugger;
        if (!eventIDS.length) {
          return of([]);
        }
        return combineLatest(eventIDS.map((eventID) => {
          return this.getEventAndActivities(user, eventID);
        }))
      }));
  }

  private getEventCollectionForUser(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: firestore.DocumentSnapshot, endBefore?: firestore.DocumentSnapshot) {
    return this.afs.collection('users')
      .doc(user.uid)
      .collection('events', ((ref) => {
        let query;
        if (where.length) {
          where.forEach(whereClause => {
            if (whereClause.fieldPath === 'startDate' && (orderBy !== 'startDate')) {
              query = ref.orderBy('startDate', 'asc')
            }
          });
          if (!query) {
            query = ref.orderBy(orderBy, asc ? 'asc' : 'desc');
          } else {
            query = query.orderBy(orderBy, asc ? 'asc' : 'desc');
          }
          where.forEach(whereClause => {
            query = query.where(whereClause.fieldPath, whereClause.opStr, whereClause.value);
          });
        } else {
          query = ref.orderBy(orderBy, asc ? 'asc' : 'desc');
        }

        if (limit > 0) {
          query = query.limit(limit)
        }
        if (startAfter) {
          // debugger;
          query = query.startAfter(startAfter);
        }
        if (endBefore) {
          // debugger;
          query = query.endBefore(endBefore);
        }
        return query;
      }))
  }

  private processStreamDocumentSnapshot(streamSnapshot: DocumentData): StreamInterface {
    this.logger.info(<string>streamSnapshot.data().type)
    return EventImporterJSON.getStreamFromJSON(this.getStreamDataFromBlob(streamSnapshot.data()));
  }

  private processStreamQueryDocumentSnapshot(queryDocumentSnapshot: firestore.QueryDocumentSnapshot): StreamInterface {
    this.logger.info(<string>queryDocumentSnapshot.data().type)
    return EventImporterJSON.getStreamFromJSON(this.getStreamDataFromBlob(<CompressedJSONStreamInterface>queryDocumentSnapshot.data()));
  }

  // From https://github.com/angular/angularfire2/issues/1400
  private async deleteAllDocsFromCollections(collections: AngularFirestoreCollection[]) {
    let totalDeleteCount = 0;
    const batchSize = 500;
    return new Promise<number>((resolve, reject) =>
      from(collections)
        .pipe(concatMap(collection => fromPromise(collection.ref.get())))
        .pipe(concatMap(q => from(q.docs)))
        .pipe(bufferCount(batchSize))
        .pipe(concatMap((docs) => Observable.create((o: Observer<number>) => {
          const batch = this.afs.firestore.batch();
          docs.forEach(doc => batch.delete(doc.ref));
          batch.commit()
            .then(() => {
              o.next(docs.length);
              o.complete()
            })
            .catch(e => o.error(e))
        })))
        .subscribe(
          (batchDeleteCount: number) => totalDeleteCount += batchDeleteCount,
          e => reject(e),
          () => resolve(totalDeleteCount),
        ))
  }

  // private getBlobFromStreamData(streamData: any[]): firestore.Blob {
  //   return firestore.Blob.fromBase64String(btoa(Pako.gzip(JSON.stringify(streamData), {to: 'string'})))
  // }

  private getCompressedStreamFromStream(stream: StreamInterface): CompressedJSONStreamInterface {
    const compressedStream: CompressedJSONStreamInterface = {
      encoding: CompressionEncodings.None,
      type: stream.type,
      data: JSON.stringify(stream.getData()),
      compressionMethod: CompressionMethods.None
    }
    this.logger.info(`[ORIGINAL] ${stream.type} = ${getSizeFormated(compressedStream.data)}`)
    if (getSize(compressedStream.data) >= 908487) {
      compressedStream.data = Pako.gzip(compressedStream.data, {to: 'string'});
      compressedStream.encoding =  CompressionEncodings.Binary
      compressedStream.compressionMethod =  CompressionMethods.Pako
      this.logger.info(`[COMPRESSED PAKO] ${stream.type} = ${getSizeFormated(compressedStream.data)}`)
    }
    if (getSize(compressedStream.data) >= 908487) {
      compressedStream.data = LZString.compress(compressedStream.data);
      compressedStream.encoding =  CompressionEncodings.Binary
      compressedStream.compressionMethod = CompressionMethods.PakoThenLZString;
      this.logger.info(`[COMPRESSED PAKO LZSTRING] ${stream.type} = ${getSizeFormated(compressedStream.data)}`)
    }
    if (getSize(compressedStream.data) >= 908487) {
      throw new Error(`Cannot compress stream ${stream.type} its more than 1048487 bytes  ${getSize(compressedStream.data)}`)
    }
    return compressedStream;
  }

  private getStreamDataFromBlob(compressedStreamJSON: CompressedJSONStreamInterface): StreamJSONInterface {
    const t0 = performance.now();
    const stream = {
      type: compressedStreamJSON.type,
      data: null
    };
    switch (compressedStreamJSON.compressionMethod) {
      default:
        // Assume legacy = Pako + base64
        stream.data = gzip_decode(compressedStreamJSON.data.toBase64())
        break;
      case CompressionMethods.None:
        stream.data = compressedStreamJSON.data
        break;
      case CompressionMethods.Pako: // Pako is the default here
        stream.data = compressedStreamJSON.encoding === CompressionEncodings.Binary
        ? gzip_decode(btoa(compressedStreamJSON.data))
        : gzip_decode(compressedStreamJSON.data)
        break;
      case CompressionMethods.PakoThenLZString:
        const a = Pako
        const b = LZString
        debugger;

        stream.data = LZString.decompress(stream.data);
        stream.data = compressedStreamJSON.encoding === CompressionEncodings.Binary
          ? Pako.ungzip(compressedStreamJSON.data, {to: 'string'})
          : gzip_decode(compressedStreamJSON.data)
    }
    const t1 = performance.now();
    this.logger.info(`Decompression with ${compressedStreamJSON.compressionMethod} took ${t1 - t0}`);
    stream.data = JSON.parse(stream.data);
    return stream;
  }
}

