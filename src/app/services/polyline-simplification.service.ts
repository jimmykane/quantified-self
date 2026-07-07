import { Injectable } from '@angular/core';
import { simplifyCoordinatePairsVisvalingamWhyatt } from '@sports-alliance/sports-lib';

export interface PolylineSimplificationOptions {
  keepRatio?: number;
  minInputPoints?: number;
  minPointsToKeep?: number;
}

export interface PolylineSimplificationResult {
  coordinates: number[][];
  inputPointCount: number;
  outputPointCount: number;
  simplified: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PolylineSimplificationService {
  public simplifyVisvalingamWhyatt(
    coordinates: number[][],
    options: PolylineSimplificationOptions = {}
  ): PolylineSimplificationResult {
    if (!Array.isArray(coordinates) || coordinates.length <= 1) {
      return {
        coordinates: Array.isArray(coordinates) ? coordinates : [],
        inputPointCount: Array.isArray(coordinates) ? coordinates.length : 0,
        outputPointCount: Array.isArray(coordinates) ? coordinates.length : 0,
        simplified: false,
      };
    }

    const result = simplifyCoordinatePairsVisvalingamWhyatt(coordinates, options);
    if (!result.simplified) {
      return {
        coordinates,
        inputPointCount: result.inputPointCount,
        outputPointCount: result.outputPointCount,
        simplified: false,
      };
    }

    return result;
  }
}
