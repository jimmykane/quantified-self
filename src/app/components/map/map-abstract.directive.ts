import { ChangeDetectorRef, Directive, inject, computed, Signal } from '@angular/core';
import { DataPositionInterface, AppThemes } from '@sports-alliance/sports-lib';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { LoggerService } from '../../services/logger.service';
import { AppThemeService } from '../../services/app.theme.service';


@Directive()
export abstract class MapAbstractDirective extends LoadingAbstractDirective {

  protected themeService = inject(AppThemeService);

  /**
   * Signal that tracks the current application theme.
   */
  public appTheme: Signal<AppThemes> = this.themeService.appTheme;

  /**
   * Computed signal that derives the map color scheme (LIGHT/DARK) from the app theme.
   */
  public mapColorScheme = computed(() => this.appTheme() === AppThemes.Dark ? 'DARK' : 'LIGHT');

  constructor(changeDetector: ChangeDetectorRef, protected logger: LoggerService) {
    super(changeDetector)
  }

  getBounds(positions: DataPositionInterface[]): google.maps.LatLngBoundsLiteral {
    // Filter out potential 0,0 points which are often GPS noise/start-up errors
    const validPositions = positions.filter(p => p.latitudeDegrees !== 0 || p.longitudeDegrees !== 0);

    if (!validPositions.length) {
      return <google.maps.LatLngBoundsLiteral>{
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

    const bounds = <google.maps.LatLngBoundsLiteral>{
      east: mostEast.longitudeDegrees,
      west: mostWest.longitudeDegrees,
      north: mostNorth.latitudeDegrees,
      south: mostSouth.latitudeDegrees,
    };
    this.logger.log('[MapAbstractDirective] getBounds result:', bounds, 'from', validPositions.length, 'valid points');
    return bounds;
  }
}
