import {Event} from '../../event';
import {EventExporterInterface} from './exporter.interface';
import {DataAltitude} from '../../../data/data.altitude';
import {DataCadence} from '../../../data/data.cadence';
import {DataHeartRate} from '../../../data/data.heart-rate';
import {DataSpeed} from '../../../data/data.speed';
import {Lap} from '../../../laps/lap';
import {EventInterface} from '../../event.interface';
import {DataInterface} from '../../../data/data.interface';
import {DataGPSAltitude} from '../../../data/data.gps-altitude';
import {PointInterface} from '../../../points/point.interface';
import {LapInterface} from '../../../laps/lap.interface';

export class EventExporterTCX implements EventExporterInterface {
  private xmlSerializer = new XMLSerializer();
  readonly fileType = 'application/tcx';
  readonly fileExtension = 'tcx';

  getAsString(event: EventInterface): string {

    // Copy
    const eventCopy = Object.create(event);

    // Create a XML document
    const xmlDocument = document.implementation.createDocument(null, null, null);

    // Create the TrainingCenterDatabase Element
    const trainingCenterDatabaseElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'TrainingCenterDatabase');
    trainingCenterDatabaseElement.setAttribute('xsi:schemaLocation', 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd');
    trainingCenterDatabaseElement.setAttribute('xmlns:ns5', 'http://www.garmin.com/xmlschemas/ActivityGoals/v1');
    trainingCenterDatabaseElement.setAttribute('xmlns:ns3', 'http://www.garmin.com/xmlschemas/ActivityExtension/v2');
    trainingCenterDatabaseElement.setAttribute('xmlns:ns2', 'http://www.garmin.com/xmlschemas/UserProfile/v2');
    trainingCenterDatabaseElement.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

    // Append it to the xmlDocument
    xmlDocument.appendChild(trainingCenterDatabaseElement);

    // Create wrapper for activites
    const activitiesElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Activities');
    trainingCenterDatabaseElement.appendChild(activitiesElement);

    // Go over all the activites
    let activityIndex = 0;
    for (const activity of eventCopy.getActivities()) {
      activityIndex++;

      // Create the activities element
      const activityElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Activity');
      activitiesElement.appendChild(activityElement);

      // Set the sport @todo should map them to Garmin accepted ones
      // For now it's forced to Running
      activityElement.setAttribute('Sport', 'Running');

      // Add an ID element
      const idElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Id');
      idElement.textContent = activity.getStartDate().toISOString().substring(0, 19) + 'Z';
      activityElement.appendChild(idElement);


      const activityLaps: LapInterface[] = activity.getLaps();


      // If there are no laps create one and clone it from the activity
      if (!activityLaps.length) {
        const lap = new Lap(activity.getStartDate(), activity.getEndDate());
        lap.setSummary(activity.getSummary());
        activityLaps.push(lap);
      }


      // Create the element
      // const creatorElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Creator'); // @todo should output the correct creator
      // creatorElement.setAttribute('xsi:type', 'Device_t');
      // const nameElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Name');
      // nameElement.textContent = activity.getCreator().getName();
      // creatorElement.appendChild(nameElement);

      // Add it to the activities
      // activityElement.appendChild(creatorElement);


      for (const lap of activityLaps) {
        // Create a lap element
        const lapElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Lap');
        // Add the first point as start time
        lapElement.setAttribute('StartTime', lap.getStartDate().toISOString().substring(0, 19) + 'Z');

        const totalTimeInSecondsElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'TotalTimeSeconds');
        totalTimeInSecondsElement.textContent = lap.getSummary().totalDurationInSeconds.toString();
        lapElement.appendChild(totalTimeInSecondsElement);

        const distanceInMetersElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'DistanceMeters');
        distanceInMetersElement.textContent = lap.getSummary().getTotalDistanceInMeters().toString();
        lapElement.appendChild(distanceInMetersElement);

        const caloriesInKCALElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Calories');
        caloriesInKCALElement.textContent = lap.getSummary().getEnergyInCal().toFixed(0).toString();
        lapElement.appendChild(caloriesInKCALElement);

        activityElement.appendChild(lapElement);
        const trackElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Track');
        lapElement.appendChild(trackElement);
        // Go over the points and find the ones without position
        let pointWithoutPosition: PointInterface;
        for (const point of activity.getPointsInterpolated(lap.getStartDate(), lap.getEndDate(), 1)) {
          if (!point.getPosition()) {
            pointWithoutPosition = point;
            continue;
          }
          // Go over date that did not have a position and append missing data
          if (pointWithoutPosition) {
            pointWithoutPosition.getData().forEach((data: DataInterface, key: string, map) => {
              if (!point.getData().get(key)) {
                point.addData(data);
              }
            });
            pointWithoutPosition = void 0;
          }

          const pointElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Trackpoint');
          trackElement.appendChild(pointElement);
          const timeElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Time');
          timeElement.textContent = point.getDate().toISOString().substring(0, 19) + 'Z';
          pointElement.appendChild(timeElement);

          const positionElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Position');
          const positionLatitudeDegreesElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'LatitudeDegrees');
          positionLatitudeDegreesElement.textContent = point.getPosition().latitudeDegrees.toString();
          const positionLongitudeDegreesElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'LongitudeDegrees');
          positionLongitudeDegreesElement.textContent = point.getPosition().longitudeDegrees.toString();
          positionElement.appendChild(positionLatitudeDegreesElement);
          positionElement.appendChild(positionLongitudeDegreesElement);
          pointElement.appendChild(positionElement);


          // Go over the Data


          const extensionsElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Extensions');
          const tpxElement = document.createElementNS('http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'TPX');
          extensionsElement.appendChild(tpxElement);
          pointElement.appendChild(extensionsElement);

          point.getData().forEach((data: DataInterface, key: string, map) => {
            if ((data instanceof DataAltitude) && !(data instanceof DataGPSAltitude)) {
              const altitudeElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'AltitudeMeters');
              altitudeElement.textContent = data.getValue().toFixed(0).toString();
              pointElement.appendChild(altitudeElement);
            } else if (data instanceof DataHeartRate) {
              const heartRateElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'HeartRateBpm');
              const heartRateValueElement = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Value');
              heartRateValueElement.textContent = data.getValue().toFixed(0).toString();
              heartRateElement.appendChild(heartRateValueElement);
              pointElement.appendChild(heartRateElement);
            } else if (data instanceof DataSpeed || data instanceof DataCadence) {
              if (data instanceof DataSpeed) {
                const speedElement = document.createElementNS('http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'Speed');
                speedElement.textContent = data.getValue().toString();
                tpxElement.appendChild(speedElement);
              }
              if (data instanceof DataCadence) {
                const cadenceElement = document.createElementNS('http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'RunCadence');
                const cadenceElementNoNS = document.createElementNS('http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2', 'Cadence');
                cadenceElement.textContent = (data.getValue() / 2).toFixed(0).toString();
                cadenceElementNoNS.textContent = (data.getValue() / 2).toFixed(0).toString();
                tpxElement.appendChild(cadenceElement);
                // Apend a normal and an extension one
                pointElement.appendChild(cadenceElementNoNS);
              }

            }


          });


        }
      }

    }
    return '<?xml version="1.0" encoding="UTF-8"?>' + this.xmlSerializer.serializeToString(xmlDocument);
  }


  getfileExtension(): string {
    return this.fileExtension;
  }

  getFileType(): string {
    return this.fileType;
  }
}
