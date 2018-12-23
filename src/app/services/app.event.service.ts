import {Injectable, OnDestroy} from '@angular/core';
import {EventLocalStorageService} from './storage/app.event.local.storage.service';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventImporterJSON} from 'quantified-self-lib/lib/events/adapters/importers/json/importer.json';
import {combineLatest, merge, EMPTY, of, Observable, Observer, from} from 'rxjs';
import {
  AngularFirestore,
  AngularFirestoreCollection,
  DocumentChangeAction,
  QueryDocumentSnapshot,
} from '@angular/fire/firestore';
import {bufferCount, catchError, concatMap, first, map, mergeMap, reduce, switchMap} from 'rxjs/operators';
import {AngularFireStorage} from '@angular/fire/storage';
import {firestore} from 'firebase/app';
import * as Pako from 'pako';
import {getSize} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {EventJSONInterface} from 'quantified-self-lib/lib/events/event.json.interface';
import {ActivityJSONInterface} from 'quantified-self-lib/lib/activities/activity.json.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {Log} from 'ng2-logger/browser';
import * as Raven from 'raven-js';
import {fromPromise} from 'rxjs/internal-compatibility';
import {EventExporterJSON} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.json';

@Injectable()
export class EventService implements OnDestroy {

  protected logger = Log.create('EventService');

  constructor(private eventLocalStorageService: EventLocalStorageService,
              private storage: AngularFireStorage,
              private afs: AngularFirestore) {
  }

  public getEventAndActivities(eventID: string): Observable<EventInterface> {
    // See
    // https://stackoverflow.com/questions/42939978/avoiding-nested-subscribes-with-combine-latest-when-one-observable-depends-on-th
    return combineLatest(
      this.afs.collection("events").doc(eventID).snapshotChanges().pipe(
        map(eventSnapshot => {
          // debugger;
          return EventImporterJSON.getEventFromJSON(<EventJSONInterface>eventSnapshot.payload.data()).setID(eventID);
        })),
      this.getActivities(eventID),
    ).pipe(catchError((error) => {
      // debugger;
      this.logger.error(error);
      Raven.captureException(error);
      return of([])
    })).pipe(map(([event, activities]) => {
      // debugger;
      event.clearActivities();
      activities.forEach((activity) => event.addActivity(activity));
      return event;
    })).pipe(catchError((error) => {
      // debugger;
      Raven.captureException(error);
      this.logger.error(error);
      return of(void 0); // @todo is this the best we can do?
    }))
  }

  public getEvents(): Observable<EventInterface[]> {
    return this.afs.collection("events").snapshotChanges().pipe(map((eventSnapshots) => {
      return eventSnapshots.reduce((eventIDS, eventSnapshot) => {
        eventIDS.push(eventSnapshot.payload.doc.id);
        return eventIDS;
      }, []);
    })).pipe(switchMap((eventIDS) => {
      // Should check if there are event ids else not return
      // debugger;
      if (!eventIDS.length) {
        return of([]);
      }
      return combineLatest(eventIDS.map((eventID) => {
        return this.getEventAndActivities(eventID);
      }))
    }))
  }

  getEventActivitiesAndStreams(eventID) {
    return this.getEventAndActivities(eventID).pipe(switchMap((event) => { // Not sure about switch or merge
      // Get all the streams for all activities and subscribe to them with latest emition for all streams
      return combineLatest(
        event.getActivities().map((activity) => {
          return this.getAllStreams(event.getID(), activity.getID()).pipe(map((streams) => {
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

  public getActivities(eventID: string): Observable<ActivityInterface[]> {
    return this.afs.collection("events").doc(eventID).collection('activities').snapshotChanges().pipe(
      map(activitySnapshots => {
        return activitySnapshots.reduce((activitiesArray: ActivityInterface[], activitySnapshot) => {
          activitiesArray.push(EventImporterJSON.getActivityFromJSON(<ActivityJSONInterface>activitySnapshot.payload.doc.data()).setID(activitySnapshot.payload.doc.id));
          return activitiesArray;
        }, []);
      }),
    )
  }

  public getAllStreams(eventID: string, activityID: string): Observable<StreamInterface[]> {
    return this.afs
      .collection('events')
      .doc(eventID)
      .collection('activities')
      .doc(activityID)
      .collection('streams')
      .snapshotChanges()
      .pipe(map((streamSnapshots) => {
        return this.processStreamSnapshots(streamSnapshots);
      }))
  }

  public getStreams(eventID: string, activityID: string, types: string[]): Observable<StreamInterface[]> {
    return combineLatest.apply(this, types.map((type) => {
      return this.afs
        .collection('events')
        .doc(eventID)
        .collection('activities')
        .doc(activityID)
        .collection('streams', ref => ref.where('type', '==', type))
        .snapshotChanges()
        .pipe(map((streamSnapshots) => { // @todo should be reduce
          return this.processStreamSnapshots(streamSnapshots)[0] // Get the first element of the return
        }))                                                      // since the return with equality on the query should only fetch one afaik in my model
    })).pipe(map((streams: StreamInterface[]) => {
      // debugger;
      return streams.filter((stream) => !!stream)
    }))
  }

  private processStreamSnapshots(streamSnapshots: DocumentChangeAction<firestore.DocumentData>[]): StreamInterface[] {
    return streamSnapshots.reduce((streamArray, streamSnapshot) => {
      streamArray.push(EventImporterJSON.getStreamFromJSON({
        type: <string>streamSnapshot.payload.doc.data().type,
        data: this.getStreamDataFromBlob(streamSnapshot.payload.doc.data().data),
      }));
      return streamArray
    }, [])
  }

  public async setEvent(event: EventInterface): Promise<void[]> {
    return new Promise<void[]>(async (resolve, reject) => {
      const streamPromises: Promise<void>[] = [];
      event.setID(event.getID() || this.afs.createId());
      event.getActivities()
        .forEach((activity) => {
          activity.setID(activity.getID() || this.afs.createId());
          streamPromises.push(this.afs.collection('events').doc(event.getID()).collection('activities').doc(activity.getID()).set(activity.toJSON()));
          activity.getAllStreams().forEach((stream) => {
            this.logger.info(`Steam ${stream.type} has size of GZIP ${getSize(firestore.Blob.fromBase64String(btoa(Pako.gzip(JSON.stringify(stream.data), {to: 'string'}))))}`);
            streamPromises.push(this.afs
              .collection('events')
              .doc(event.getID())
              .collection('activities')
              .doc(activity.getID())
              .collection('streams')
              .doc(stream.type) // @todo check this how it behaves
              .set({
                type: stream.type,
                data: this.getBlobFromStreamData(stream.data),
              }))
          });
        });
      try {
        await Promise.all(streamPromises);
        await this.afs.collection('events').doc(event.getID()).set(event.toJSON());
        resolve()
      } catch (e) {
        Raven.captureException(e);
        // Try to delete the parent entity and all subdata
        await this.deleteEvent(event.getID());
        reject('Something went wrong')
      }
    })
  }

  public async deleteEvent(eventID: string): Promise<boolean> {
    const activityDeletePromises: Promise<boolean>[] = [];
    const queryDocumentSnapshots = await this.afs
      .collection('events')
      .doc(eventID).collection('activities').ref.get();
    queryDocumentSnapshots.docs.forEach((queryDocumentSnapshot) => {
      activityDeletePromises.push(this.deleteActivity(eventID, queryDocumentSnapshot.id))
    });
    await Promise.all(activityDeletePromises);
    await this.afs
      .collection('events')
      .doc(eventID).delete();
    this.logger.info(`Deleted event ${eventID}`);
    return true;
  }

  public async deleteActivity(eventID: string, activityID: string): Promise<boolean> {
    // @todo add try catch etc
    await this.deleteAllStreams(eventID, activityID);
    await this.afs
      .collection('events')
      .doc(eventID)
      .collection('activities')
      .doc(activityID).delete();
    this.logger.info(`Deleted activity ${activityID} for event ${eventID}`);
    return true;
  }

  public async deleteAllStreams(eventID, activityID): Promise<number> {
    const numberOfStreamsDeleted = await this.deleteAllDocsFromCollections([
      this.afs.collection('events').doc(eventID).collection('activities').doc(activityID).collection('streams'),
    ]);
    this.logger.info(`Deleted ${numberOfStreamsDeleted} streams for event: ${eventID} and activity ${activityID}`);
    return numberOfStreamsDeleted
  }

  public async getEventAsJSONBloB(eventID: string): Promise<Blob> {
    const jsonString = await EventExporterJSON.getAsString(await this.getEventActivitiesAndStreams(eventID).pipe(first()).toPromise());
    return (new Blob(
      [jsonString],
      {type: EventExporterJSON.fileType},
    ));
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

// // Save the whole event to a json file
// // Save the points as a json string in storage and link to id etc
// const filePath = event.getID();
// const ref = this.storage.ref(filePath);
// const task = ref.putString(JSON.stringify(event.toJSON()));
//
//
// task.snapshotChanges().pipe(
//     finalize(() => {
//       debugger
//       batch.commit();
//     })
//  )
// .subscribe()

