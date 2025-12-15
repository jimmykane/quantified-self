import { ChangeDetectorRef, Directive } from '@angular/core';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { DataPositionInterface } from '@sports-alliance/sports-lib';
import { MapThemes } from '@sports-alliance/sports-lib';
// import LatLngBoundsLiteral = google.maps.LatLngBoundsLiteral;

declare function require(moduleName: string): any;

const mapStyles = require('./map-styles.json');

export interface LiteralBounds {
  east: number;
  west: number;
  north: number;
  south: number;
}

@Directive()
export abstract class MapAbstractDirective extends LoadingAbstractDirective {

  constructor(changeDetector: ChangeDetectorRef) {
    super(changeDetector)
  }

  getBounds(postions: DataPositionInterface[]): LiteralBounds {
    if (!postions.length) {
      return <LiteralBounds>{
        east: 0,
        west: 0,
        north: 0,
        south: 0,
      };
    }
    const mostEast = postions.reduce((acc: { latitudeDegrees: number, longitudeDegrees: number }, latLongPair: { latitudeDegrees: number, longitudeDegrees: number }) => {
      return (acc.longitudeDegrees < latLongPair.longitudeDegrees) ? latLongPair : acc;
    });
    const mostWest = postions.reduce((acc: { latitudeDegrees: number, longitudeDegrees: number }, latLongPair: { latitudeDegrees: number, longitudeDegrees: number }) => {
      return (acc.longitudeDegrees > latLongPair.longitudeDegrees) ? latLongPair : acc;
    });

    const mostNorth = postions.reduce((acc: { latitudeDegrees: number, longitudeDegrees: number }, latLongPair: { latitudeDegrees: number, longitudeDegrees: number }) => {
      return (acc.latitudeDegrees < latLongPair.latitudeDegrees) ? latLongPair : acc;
    });

    const mostSouth = postions.reduce((acc: { latitudeDegrees: number, longitudeDegrees: number }, latLongPair: { latitudeDegrees: number, longitudeDegrees: number }) => {
      return (acc.latitudeDegrees > latLongPair.latitudeDegrees) ? latLongPair : acc;
    });

    return <LiteralBounds>{
      east: mostEast.longitudeDegrees,
      west: mostWest.longitudeDegrees,
      north: mostNorth.latitudeDegrees,
      south: mostSouth.latitudeDegrees,
    };
  }

  getStyles(mapTheme: MapThemes) {
    // If the theme is not found try to find the Dark theme or else return the default
    return mapStyles[mapTheme] || mapStyles['Dark'] || [];
  }
}
