import {Injectable, OnDestroy} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventImporterJSON} from 'quantified-self-lib/lib/events/adapters/importers/json/importer.json';
import {combineLatest, merge, EMPTY, of, Observable, Observer, from, zip} from 'rxjs';
import {
  Action,
  AngularFirestore,
  AngularFirestoreCollection,
  DocumentChangeAction, DocumentSnapshot, DocumentSnapshotExists,
  QueryDocumentSnapshot,
} from '@angular/fire/firestore';
import {bufferCount, catchError, concatMap, first, map, mergeMap, reduce, switchMap, take} from 'rxjs/operators';
import {AngularFireStorage} from '@angular/fire/storage';
import {FirebaseError, firestore} from 'firebase/app';
import * as Pako from 'pako';
import {EventJSONInterface} from 'quantified-self-lib/lib/events/event.json.interface';
import {ActivityJSONInterface} from 'quantified-self-lib/lib/activities/activity.json.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {Log} from 'ng2-logger/browser';
import * as Sentry from '@sentry/browser';
import {fromPromise} from 'rxjs/internal-compatibility';
import {EventExporterJSON} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.json';
import {User} from 'quantified-self-lib/lib/users/user';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {getSize} from 'quantified-self-lib/lib/events/utilities/helpers';
import {DataDeviceNames} from 'quantified-self-lib/lib/data/data.device-names';

@Injectable()
export class EventService implements OnDestroy {

  protected logger = Log.create('EventService');

  constructor(
    private storage: AngularFireStorage,
    private afs: AngularFirestore) {
  }

  public getEventAndActivities(user: User, eventID: string): Observable<EventInterface> {
    // See
    // https://stackoverflow.com/questions/42939978/avoiding-nested-subscribes-with-combine-latest-when-one-observable-depends-on-th
    this.logger.info(`Getting ${user.uid} and ${eventID}`);
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
      if (error.code && error.code === 'permission-denied') {
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

  public getEventsForUserBy(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    if (startAfter || endBefore) {
      return this.getEventsForUserStartingAfterOrEndingBefore(user, false, where, orderBy, asc, limit, startAfter, endBefore);
    }
    return this.getEventsForUserInternal(user, where, orderBy, asc, limit);
  }

  public getEventsAndActivitiesForUserBy(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    if (startAfter || endBefore) {
      return this.getEventsForUserStartingAfterOrEndingBefore(user, true, where, orderBy, asc, limit, startAfter, endBefore);
    }
    return this.getEventsAndActivitiesForUserInternal(user, where, orderBy, asc, limit);
  }

  private getEventsForUserStartingAfterOrEndingBefore(user: User, getActivities: boolean, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
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
        return getActivities ? this.getEventsAndActivitiesForUserInternal(user, where, orderBy, asc, limit, resultA, resultB) : this.getEventsForUserInternal(user, where, orderBy, asc, limit, resultA, resultB);
      }
      // If only start after
      if (startAfter) {
        return getActivities ? this.getEventsAndActivitiesForUserInternal(user, where, orderBy, asc, limit, resultA) : this.getEventsForUserInternal(user, where, orderBy, asc, limit, resultA);
      }
      // If only endAt
      return getActivities ? this.getEventsAndActivitiesForUserInternal(user, where, orderBy, asc, limit, null, resultA) : this.getEventsForUserInternal(user, where, orderBy, asc, limit, null, resultA);
    }));
  }


  private getEventsForUserInternal(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: firestore.DocumentSnapshot, endBefore?: firestore.DocumentSnapshot): Observable<EventInterface[]> {
    return this.getEventCollectionForUser(user, where, orderBy, asc, limit, startAfter, endBefore)
      .snapshotChanges().pipe(map((eventSnapshots) => {
        return eventSnapshots.map((eventSnapshot) => {
          return eventSnapshot.payload.doc.exists ? EventImporterJSON.getEventFromJSON(<EventJSONInterface>eventSnapshot.payload.doc.data()).setID(eventSnapshot.payload.doc.id) : null;
        })
      }))
  }

  private getEventsAndActivitiesForUserInternal(user: User, where: { fieldPath: string | firestore.FieldPath, opStr: firestore.WhereFilterOp, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: firestore.DocumentSnapshot, endBefore?: firestore.DocumentSnapshot): Observable<EventInterface[]> {
    const eventObservable = this.getEventCollectionForUser(user, where, orderBy, asc, limit, startAfter, endBefore)
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
    return eventObservable;
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

  getEventActivitiesAndStreams(user: User, eventID) {
    return this.getEventAndActivities(user, eventID).pipe(switchMap((event) => { // Not sure about switch or merge
      if (!event) {
        return of(null);
      }
      // Get all the streams for all activities and subscribe to them with latest emition for all streams
      return combineLatest(
        event.getActivities().map((activity) => {
          return this.getAllStreams(user, event.getID(), activity.getID()).pipe(map((streams) => {
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

  public getActivities(user: User, eventID: string): Observable<ActivityInterface[]> {
    return this.afs
      .collection('users')
      .doc(user.uid)
      .collection('events').doc(eventID).collection('activities').snapshotChanges().pipe(
        map(activitySnapshots => {
          return activitySnapshots.reduce((activitiesArray: ActivityInterface[], activitySnapshot) => {
            activitiesArray.push(EventImporterJSON.getActivityFromJSON(<ActivityJSONInterface>activitySnapshot.payload.doc.data()).setID(activitySnapshot.payload.doc.id));
            return activitiesArray;
          }, []);
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
    return combineLatest.apply(this, types.map((type) => {
      return this.afs
        .collection('users')
        .doc(userID)
        .collection('events')
        .doc(eventID)
        .collection('activities')
        .doc(activityID)
        .collection('streams')
        .doc(type)
        .snapshotChanges()
        .pipe(map((documentSnapshot) => { // @todo should be reduce
          return documentSnapshot.payload.exists ? this.processStreamDocumentSnapshots(documentSnapshot) : null;
        }))                                                      // since the return with equality on the query should only fetch one afaik in my model
    })).pipe(map((streams: StreamInterface[]) => {
      return streams.filter((stream) => !!stream)
    }))
  }

  private processStreamDocumentSnapshots(streamSnapshot: Action<firestore.DocumentSnapshot>): StreamInterface {
    return EventImporterJSON.getStreamFromJSON({
      type: <string>streamSnapshot.payload.data().type,
      data: this.getStreamDataFromBlob(streamSnapshot.payload.data().data),
    });
  }

  private processStreamQueryDocumentSnapshot(queryDocumentSnapshot: firestore.QueryDocumentSnapshot): StreamInterface {
    return EventImporterJSON.getStreamFromJSON({
      type: <string>queryDocumentSnapshot.data().type,
      data: this.getStreamDataFromBlob(queryDocumentSnapshot.data().data),
    });
  }

  public async setEvent(user: User, event: EventInterface) {
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
          // this.logger.info(`Steam ${stream.type} has size of GZIP ${getSize(this.getBlobFromStreamData(stream.data))}`);
          // this.logger.info(`Steam ${stream.type} has size of GZIP ${getSize(firestore.Blob.fromUint8Array(Pako.gzip(JSON.stringify(stream.data))))}`);
          // console.log(`Stream ${stream.type} has size of GZIP ${getSize(Buffer.from((Pako.gzip(JSON.stringify(stream.data), {to: 'string'})), 'binary'))}`);
          writePromises.push(this.afs
            .collection('users')
            .doc(user.uid)
            .collection('events')
            .doc(event.getID())
            .collection('activities')
            .doc(activity.getID())
            .collection('streams')
            .doc(stream.type)
            .set({
              type: stream.type,
              data: this.getBlobFromStreamData(stream.data),
            }))
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

  public async setActivity(user: User, event: EventInterface, activity: ActivityInterface) {
    return this.afs.collection('users').doc(user.uid).collection('events').doc(event.getID()).collection('activities').doc(activity.getID()).set(activity.toJSON());
  }

  public async changeActivityCreatorName(user: User, event: EventInterface, activity: ActivityInterface, creatorName: string) {
    debugger;
    activity.creator.name = creatorName;
    await this.setActivity(user, event, activity);
    event.addStat(new DataDeviceNames(event.getActivities().map(eventActivities => eventActivities.creator.name)));
    await this.setEvent(user, event);
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
    const jsonString = await EventExporterJSON.getAsString(await this.getEventActivitiesAndStreams(user, eventID).pipe(take(1)).toPromise());
    return (new Blob(
      [jsonString],
      {type: EventExporterJSON.fileType},
    ));
  }

  public async setEventPrivacy(user: User, eventID: string, privacy: Privacy) {
    return this.updateEventProperties(user, eventID, {privacy: privacy});
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

  private getBlobFromStreamData(streamData: number[]): firestore.Blob {
    return firestore.Blob.fromBase64String(btoa(Pako.gzip(JSON.stringify(streamData), {to: 'string'})))
  }

  private getStreamDataFromBlob(blob: firestore.Blob): number[] {
    return JSON.parse(Pako.ungzip(atob(blob.toBase64()), {to: 'string'}));
  }

  ngOnDestroy() {
  }

}

