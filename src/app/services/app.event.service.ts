import {Injectable, OnDestroy} from '@angular/core';
import {EventLocalStorageService} from './storage/app.event.local.storage.service';
import {GeoLocationInfoService} from './geo-location/app.geo-location-info.service';
import {WeatherUndergroundWeatherService} from './weather/app.weather-underground.weather.service';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {GeoLocationInfo} from 'quantified-self-lib/lib/geo-location-info/geo-location-info';
import {Weather} from 'quantified-self-lib/lib/weather/app.weather';
import {DataPositionInterface} from 'quantified-self-lib/lib/data/data.position.interface';
import {EventImporterJSON} from 'quantified-self-lib/lib/events/adapters/importers/json/importer.json';
import {combineLatest, merge, Observable, EMPTY, of} from 'rxjs';
import {AngularFirestore} from '@angular/fire/firestore';
import {catchError, map, mergeMap, switchMap} from 'rxjs/operators';
import {AngularFireStorage} from '@angular/fire/storage';
import {firestore} from 'firebase/app';
import * as Pako from 'pako';
import {getSize} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {EventJSONInterface} from 'quantified-self-lib/lib/events/event.json.interface';
import {ActivityJSONInterface} from 'quantified-self-lib/lib/activities/activity.json.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {StreamJSONInterface} from 'quantified-self-lib/lib/streams/stream.json.interface';

@Injectable()
export class EventService implements OnDestroy {

  constructor(private eventLocalStorageService: EventLocalStorageService,
              private storage: AngularFireStorage,
              private weatherService: WeatherUndergroundWeatherService,
              private afs: AngularFirestore,
              private geoLocationInfoService: GeoLocationInfoService) {
  }

  public getEvent(eventID: string): Observable<EventInterface> {
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
      return of([])
    })).pipe(map(([event, activities]) => {
      // debugger;
      event.clearActivities();
      activities.forEach((activity) => event.addActivity(activity));
      return event;
    })).pipe(catchError((error) => {
      return EMPTY;
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
        return this.getEvent(eventID);
      }))
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
        // @todo merge this to it's own function
        return streamSnapshots.reduce((streamArray, streamSnapshot) => {
          streamArray.push(EventImporterJSON.getStreamFromJSON({
            type: <string>streamSnapshot.payload.doc.data().type,
            data: this.getStreamDataFromBlob(streamSnapshot.payload.doc.data().data),
          }));
          return streamArray
        }, [])
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
        .pipe(map((streamSnapshots) => {
          return streamSnapshots.reduce((streamArray, streamSnapshot) => {
            streamArray.push(EventImporterJSON.getStreamFromJSON({
              type: <string>streamSnapshot.payload.doc.data().type,
              data: this.getStreamDataFromBlob(streamSnapshot.payload.doc.data().data),
            }));
            return streamArray
          }, [])
        }))
    }))
  }

  public async setEvent(event: EventInterface): Promise<void[]> {
    const promises: Promise<void>[] = [];
    event.setID(event.getID() || this.afs.createId());
    promises.push(this.afs.collection('events').doc(event.getID()).set(event.toJSON()));
    event.getActivities()
      .forEach((activity) => {
        activity.setID(activity.getID() || this.afs.createId());
        promises.push(this.afs.collection('events').doc(event.getID()).collection('activities').doc(activity.getID()).set(activity.toJSON()));
        activity.streams.forEach((stream) => {
          // console.log(`Steam ${stream.type} has size of GZIP ${getSize(firestore.Blob.fromBase64String(btoa(Pako.gzip(JSON.stringify(stream.data), {to: 'string'}))))}`);
          promises.push(this.afs
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
    return Promise.all(promises);
  }

  public deleteEvent(eventToDelete: EventInterface) {
    this.afs.collection('events').doc(eventToDelete.getID()).collection('activities').snapshotChanges();
    // this.afs.collection('events').doc(eventToDelete.getID()).delete();
  }

  /**
   * Add geolocation and weather info to an event
   * @param {EventInterface} event
   * @return {Promise<EventInterface>}
   * @todo Write tests!
   */
  public addGeoLocationAndWeatherInfo(event: EventInterface): Promise<EventInterface> {
    return new Promise(((resolve, reject) => {
      // Find the activities with positional data
      const activitiesWithPosition = event.getActivities().filter((activity) => {
        return event.getPointsWithPosition(void 0, void 0, [activity]).length
      });
      // Create their promises
      const activitiesPromises = activitiesWithPosition.reduce((activityPromises, activity) => {
        activityPromises.push(this.geoLocationInfoService.getGeoLocationInfo(
          <DataPositionInterface>event.getPointsWithPosition(void 0, void 0, [activity])[0].getPosition(),
        ));
        activityPromises.push(this.weatherService.getWeather(
          <DataPositionInterface>event.getPointsWithPosition(void 0, void 0, [activity])[0].getPosition(), activity.startDate,
        ));
        return activityPromises;
      }, []);

      // Wait for all
      Promise.all(activitiesPromises.map(p => p.catch(e => e))).then(results => {
        if (!results || !results.length) {
          resolve(event);
        }
        // For each activity get 2 data from the results
        let i = 0;
        activitiesWithPosition.forEach((activity, index) => {
          if (results[index + i] instanceof GeoLocationInfo) {
            activity.geoLocationInfo = <GeoLocationInfo> results[index + i];
          }
          if (results[index + i + 1] instanceof Weather) {
            activity.weather = <Weather> results[index + i + 1];
          }
          i += 2;
        });
        resolve(event);
      }).catch((e) => {
        reject(event);
      });
    }));
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

