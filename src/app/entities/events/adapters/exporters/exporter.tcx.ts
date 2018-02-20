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
    const trainingCenterDatabaseElement = document.createElementNS(null, 'TrainingCenterDatabase');
    trainingCenterDatabaseElement.setAttribute('xsi:schemaLocation', 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd');
    trainingCenterDatabaseElement.setAttribute('xmlns:ns5', 'http://www.garmin.com/xmlschemas/ActivityGoals/v1');
    trainingCenterDatabaseElement.setAttribute('xmlns:ns3', 'http://www.garmin.com/xmlschemas/ActivityExtension/v2');
    trainingCenterDatabaseElement.setAttribute('xmlns:ns2', 'http://www.garmin.com/xmlschemas/UserProfile/v2');
    trainingCenterDatabaseElement.setAttribute('xmlns', 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2');
    trainingCenterDatabaseElement.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

    // Append it to the xmlDocument
    xmlDocument.appendChild(trainingCenterDatabaseElement);

    // Go over all the activites
    for (const activity of eventCopy.getActivities()) {

      // Create wrapper for activites
      const activitiesElement = document.createElementNS(null, 'Activities');
      trainingCenterDatabaseElement.appendChild(activitiesElement);

      // Create the activities element
      const activityElement = document.createElementNS(null, 'Activity');
      activitiesElement.appendChild(activityElement);

      // Set the sport @todo should map them to Garmin accepted ones
      // For now it's forced to Running
      activityElement.setAttribute('Sport', 'Running');

      // Add an ID element
      const idElement = document.createElementNS(null, 'Id');
      idElement.textContent = activity.getStartDate().toISOString().substring(0, 19) + 'Z';
      activityElement.appendChild(idElement);


      // Create the element
      // const creatorElement = document.createElementNS(null, 'Creator'); // @todo should output the correct creator
      // creatorElement.setAttribute('xsi:type', 'Device_t');
      // const nameElement = document.createElementNS(null, 'Name');
      // nameElement.textContent = activity.getCreator().getName();
      // creatorElement.appendChild(nameElement);

      // Add it to the activities
      // activityElement.appendChild(creatorElement);

      // Create a lap element
      const lapElement = document.createElementNS(null, 'Lap');
      // Add the first point as start time
      lapElement.setAttribute('StartTime', activity.getPoints()[0].getDate().toISOString().substring(0, 19) + 'Z');
      // @todo create laps if they exist
      const totalTimeInSecondsElement = document.createElementNS(null, 'TotalTimeSeconds');
      totalTimeInSecondsElement.textContent = activity.getSummary().getTotalDurationInSeconds().toString();
      lapElement.appendChild(totalTimeInSecondsElement);

      const distanceInMetersElement = document.createElementNS(null, 'DistanceMeters');
      distanceInMetersElement.textContent = event.getSummary().getTotalDistanceInMeters().toString();
      lapElement.appendChild(distanceInMetersElement);

      activityElement.appendChild(lapElement);
      const trackElement = document.createElementNS(null, 'Track');
      lapElement.appendChild(trackElement);

      // Go over the points and find the ones without position
      let pointWithoutPosition: PointInterface;
      for (const point of activity.getPoints()) {
        if (!point.getPosition()) {
          pointWithoutPosition = point;
          continue;
        }
        // Go over date that did not have a position and append missing data
        if (pointWithoutPosition) {
          pointWithoutPosition.getData().forEach((dataArray: DataInterface[], key: string, map) => {
            if (!point.getData().get(key)) {
              dataArray.forEach((data: DataInterface) => {
                point.addData(data);
              });
            }
          });
          pointWithoutPosition = void 0;
        }

        const pointElement = document.createElementNS(null, 'Trackpoint');
        trackElement.appendChild(pointElement);
        const timeElement = document.createElementNS(null, 'Time');
        timeElement.textContent = point.getDate().toISOString().substring(0, 19) + 'Z';
        pointElement.appendChild(timeElement);

        const positionElement = document.createElementNS(null, 'Position');
        const positionLatitudeDegreesElement = document.createElementNS(null, 'LatitudeDegrees');
        positionLatitudeDegreesElement.textContent = point.getPosition().latitudeDegrees.toString();
        const positionLongitudeDegreesElement = document.createElementNS(null, 'LongitudeDegrees');
        positionLongitudeDegreesElement.textContent = point.getPosition().longitudeDegrees.toString();
        positionElement.appendChild(positionLatitudeDegreesElement);
        positionElement.appendChild(positionLongitudeDegreesElement);
        pointElement.appendChild(positionElement);


        // Go over the Data


        const extensionsElement = document.createElementNS(null, 'Extensions');
        const tpxElement = document.createElementNS('http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'TPX');
        extensionsElement.appendChild(tpxElement);
        pointElement.appendChild(extensionsElement);

        point.getData().forEach((dataArray: DataInterface[], key: string, map) => {
          const data = dataArray[0];
          if ((data instanceof DataAltitude) && !(data instanceof DataGPSAltitude)) {
            const altitudeElement = document.createElementNS(null, 'AltitudeMeters');
            altitudeElement.textContent = data.getValue().toFixed(0).toString();
            pointElement.appendChild(altitudeElement);
          } else if (data instanceof DataHeartRate) {
            const heartRateElement = document.createElementNS(null, 'HeartRateBpm');
            const heartRateValueElement = document.createElementNS(null, 'Value');
            heartRateValueElement.textContent = data.getValue().toFixed(0).toString();
            heartRateElement.appendChild(heartRateValueElement);
            pointElement.appendChild(heartRateElement);
          } else if (data instanceof DataSpeed || data instanceof DataCadence) {
            if (data instanceof DataSpeed) {
              const speedElement = document.createElementNS('http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'Speed');
              speedElement.textContent = data.getValue().toFixed().toString();
              tpxElement.appendChild(speedElement);
            }
            if (data instanceof DataCadence) {
              const cadenceElement = document.createElementNS('http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'RunCadence');
              const cadenceElementNoNS = document.createElementNS(null, 'Cadence');
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
    return '<?xml version="1.0" encoding="UTF-8"?>' + this.xmlSerializer.serializeToString(xmlDocument);
  }


  getfileExtension(): string {
    return this.fileExtension;
  }

  getFileType(): string {
    return this.fileType;
  }
}
