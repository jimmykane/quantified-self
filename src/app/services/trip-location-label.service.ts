import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

interface MapboxFeature {
  text?: string;
  place_name?: string;
  place_type?: string[];
}

interface MapboxReverseGeocodingResponse {
  features?: MapboxFeature[];
}

@Injectable({
  providedIn: 'root'
})
export class TripLocationLabelService {
  private static readonly ROUNDING_PRECISION = 2;
  private readonly cache = new Map<string, Promise<string | null>>();

  public resolveCountryName(latitudeDegrees: number, longitudeDegrees: number): Promise<string | null> {
    if (!Number.isFinite(latitudeDegrees) || !Number.isFinite(longitudeDegrees)) {
      return Promise.resolve(null);
    }

    if (Math.abs(latitudeDegrees) > 90 || Math.abs(longitudeDegrees) > 180) {
      return Promise.resolve(null);
    }

    const cacheKey = this.toCacheKey(latitudeDegrees, longitudeDegrees);
    const cachedLookup = this.cache.get(cacheKey);
    if (cachedLookup) {
      return cachedLookup;
    }

    const lookup = this.fetchCountryName(latitudeDegrees, longitudeDegrees)
      .catch(() => null);

    this.cache.set(cacheKey, lookup);
    return lookup;
  }

  private toCacheKey(latitudeDegrees: number, longitudeDegrees: number): string {
    const roundedLat = latitudeDegrees.toFixed(TripLocationLabelService.ROUNDING_PRECISION);
    const roundedLng = longitudeDegrees.toFixed(TripLocationLabelService.ROUNDING_PRECISION);
    return `${roundedLat},${roundedLng}`;
  }

  private async fetchCountryName(latitudeDegrees: number, longitudeDegrees: number): Promise<string | null> {
    const token = environment.mapboxAccessToken;
    if (!token) return null;

    const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitudeDegrees},${latitudeDegrees}.json?types=country&access_token=${token}`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as MapboxReverseGeocodingResponse;
    const countryFeature = payload.features?.find((feature) => feature.place_type?.includes('country'));
    const fallbackFeature = payload.features?.[0];
    const label = countryFeature?.text || countryFeature?.place_name || fallbackFeature?.text || fallbackFeature?.place_name;

    if (!label) {
      return null;
    }

    const normalized = label.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
