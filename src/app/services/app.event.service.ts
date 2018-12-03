import {Injectable, OnDestroy} from '@angular/core';
import {List} from 'immutable';
import {EventLocalStorageService} from './storage/app.event.local.storage.service';
import {GeoLocationInfoService} from './geo-location/app.geo-location-info.service';
import {WeatherUndergroundWeatherService} from './weather/app.weather-underground.weather.service';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {GeoLocationInfo} from 'quantified-self-lib/lib/geo-location-info/geo-location-info';
import {Weather} from 'quantified-self-lib/lib/weather/app.weather';
import {DataPositionInterface} from 'quantified-self-lib/lib/data/data.position.interface';
import {EventImporterJSON} from 'quantified-self-lib/lib/events/adapters/importers/json/importer.json';
import {Observable} from 'rxjs';
import {AngularFirestore} from '@angular/fire/firestore';
import {map, mergeMap} from 'rxjs/operators';
import {AngularFireStorage} from '@angular/fire/storage';
import {firestore} from 'firebase/app';
import * as Pako from 'pako';
import {getSize} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {EventJSONInterface} from 'quantified-self-lib/lib/events/event.json.interface';

@Injectable()
export class EventService implements OnDestroy {

  constructor(private eventLocalStorageService: EventLocalStorageService,
              private storage: AngularFireStorage,
              private weatherService: WeatherUndergroundWeatherService,
              private afs: AngularFirestore,
              private geoLocationInfoService: GeoLocationInfoService) {
  }

  public getEvent(eventID: string): Observable<EventInterface> {
    return this.afs.collection("events").doc(eventID).snapshotChanges().pipe(
      mergeMap(document => {
        return EventImporterJSON.getFromJSON(document.payload.data())
      }),
    );
  }

  public getEvents(): Observable<EventInterface[]> {
    return this.afs.collection("events").snapshotChanges().pipe(
      map(eventSnapshots => {
        return eventSnapshots.reduce((eventsArray: EventInterface[], eventSnapshot) => {
          eventsArray.push(EventImporterJSON.getEventFromJSON(<EventJSONInterface>eventSnapshot.payload.doc.data()));
          return eventsArray;
        }, []);
      }),
    );
  }

  public async addEvent(event: EventInterface): Promise<void[]> {
    // Set the id to the ref // @todo perhaps make the ID non generated or solve this properly
    event.setID(this.afs.createId());
    event.getActivities().forEach((activity) => activity.setID(this.afs.createId()));

    const promises: Promise<void>[] = [];

    promises.push(this.afs.collection('events').doc(event.getID()).set(event.toJSON()));

    event.getActivities()
      .forEach((activity) => {
        promises.push(this.afs.collection('events').doc(event.getID()).collection('activities').doc(activity.getID()).set(activity.toJSON()));
        activity.streams.forEach((stream) => {
          // console.log(`Steam ${stream.type} has size of GZIP ${getSize(firestore.Blob.fromBase64String(btoa(Pako.gzip(JSON.stringify(stream.data), {to: 'string'}))))}`);
          promises.push(this.afs
            .collection('events')
            .doc(event.getID())
            .collection('activities')
            .doc(activity.getID())
            .collection('streams')
            .doc(stream.type)
            .set({[stream.type]: firestore.Blob.fromBase64String(btoa(Pako.gzip(stream.data, {to: 'string'})))}))
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

