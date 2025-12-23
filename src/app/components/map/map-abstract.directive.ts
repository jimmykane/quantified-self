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

  getBounds(positions: DataPositionInterface[]): LiteralBounds {
    // Filter out potential 0,0 points which are often GPS noise/start-up errors
    const validPositions = positions.filter(p => p.latitudeDegrees !== 0 || p.longitudeDegrees !== 0);

    if (!validPositions.length) {
      return <LiteralBounds>{
        east: 0,
        west: 0,
        north: 0,
        south: 0,
      };
    }
    const mostEast = validPositions.reduce((acc, latLongPair) => {
      return (acc.longitudeDegrees < latLongPair.longitudeDegrees) ? latLongPair : acc;
    });
    const mostWest = validPositions.reduce((acc, latLongPair) => {
      return (acc.longitudeDegrees > latLongPair.longitudeDegrees) ? latLongPair : acc;
    });

    const mostNorth = validPositions.reduce((acc, latLongPair) => {
      return (acc.latitudeDegrees < latLongPair.latitudeDegrees) ? latLongPair : acc;
    });

    const mostSouth = validPositions.reduce((acc, latLongPair) => {
      return (acc.latitudeDegrees > latLongPair.latitudeDegrees) ? latLongPair : acc;
    });

    const bounds = <LiteralBounds>{
      east: mostEast.longitudeDegrees,
      west: mostWest.longitudeDegrees,
      north: mostNorth.latitudeDegrees,
      south: mostSouth.latitudeDegrees,
    };
    console.log('[MapAbstractDirective] getBounds result:', bounds, 'from', validPositions.length, 'valid points');
    return bounds;
  }

  getStyles(mapTheme: MapThemes) {
    // If the theme is not found try to find the Dark theme or else return the default
    return mapStyles[mapTheme] || mapStyles['Dark'] || [];
  }
}
