import { Injectable } from '@angular/core';
import visWhy from 'vis-why';

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

    const validInputCoordinates = this.toCoordinatePairs(coordinates);
    const inputPointCount = validInputCoordinates.length;

    if (inputPointCount <= 1) {
      return {
        coordinates,
        inputPointCount,
        outputPointCount: inputPointCount,
        simplified: false,
      };
    }

    const keepRatio = this.clampKeepRatio(options.keepRatio);
    const minInputPoints = this.clampPointThreshold(options.minInputPoints);
    const minPointsToKeep = this.clampPointThreshold(options.minPointsToKeep);

    if (inputPointCount < minInputPoints) {
      return {
        coordinates,
        inputPointCount,
        outputPointCount: inputPointCount,
        simplified: false,
      };
    }

    const computedTarget = Math.round(inputPointCount * keepRatio);
    const targetPointCount = Math.min(inputPointCount, Math.max(minPointsToKeep, computedTarget));

    if (targetPointCount >= inputPointCount) {
      return {
        coordinates,
        inputPointCount,
        outputPointCount: inputPointCount,
        simplified: false,
      };
    }

    try {
      const simplifiedCoordinates = this.runVisvalingamWhyatt(validInputCoordinates, targetPointCount);
      const validOutputCoordinates = this.toCoordinatePairs(simplifiedCoordinates);

      if (validOutputCoordinates.length < 2 || validOutputCoordinates.length >= inputPointCount) {
        return {
          coordinates,
          inputPointCount,
          outputPointCount: inputPointCount,
          simplified: false,
        };
      }

      return {
        coordinates: validOutputCoordinates,
        inputPointCount,
        outputPointCount: validOutputCoordinates.length,
        simplified: true,
      };
    } catch {
      return {
        coordinates,
        inputPointCount,
        outputPointCount: inputPointCount,
        simplified: false,
      };
    }
  }

  private runVisvalingamWhyatt(coordinates: [number, number][], targetPointCount: number): [number, number][] {
    return visWhy(coordinates, targetPointCount);
  }

  private toCoordinatePairs(coordinates: number[][]): [number, number][] {
    return (coordinates || [])
      .filter((coordinate): coordinate is [number, number] =>
        Array.isArray(coordinate)
        && coordinate.length >= 2
        && Number.isFinite(coordinate[0])
        && Number.isFinite(coordinate[1])
      )
      .map((coordinate) => [coordinate[0], coordinate[1]]);
  }

  private clampKeepRatio(value: number | undefined): number {
    if (!Number.isFinite(value)) {
      return 1;
    }
    if ((value as number) <= 0) {
      return 1;
    }
    return Math.min(1, value as number);
  }

  private clampPointThreshold(value: number | undefined): number {
    if (!Number.isFinite(value)) {
      return 2;
    }
    return Math.max(2, Math.round(value as number));
  }
}
