import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { LoggerService } from './logger.service';

export interface ResolvedTripLocationLabel {
  city: string | null;
  country: string | null;
  label: string | null;
}

interface MapboxFeature {
  text?: string;
  place_name?: string;
  place_type?: string[];
  context?: MapboxContextFeature[];
}

interface MapboxContextFeature {
  id?: string;
  text?: string;
}

interface MapboxReverseGeocodingResponse {
  features?: MapboxFeature[];
}

@Injectable({
  providedIn: 'root'
})
export class TripLocationLabelService {
  private static readonly ROUNDING_PRECISION = 2;
  private readonly cache = new Map<string, Promise<ResolvedTripLocationLabel | null>>();
  private readonly logger = inject(LoggerService);

  public resolveCountryName(latitudeDegrees: number, longitudeDegrees: number): Promise<string | null> {
    return this.resolveTripLocation(latitudeDegrees, longitudeDegrees)
      .then((resolved) => resolved?.country ?? null);
  }

  public resolveTripLocation(latitudeDegrees: number, longitudeDegrees: number): Promise<ResolvedTripLocationLabel | null> {
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

    const lookup = this.fetchTripLocation(latitudeDegrees, longitudeDegrees)
      .catch((error) => {
        this.logger.log('[TripLocationLabelService] Geocoding failed while resolving trip location.', {
          latitudeDegrees,
          longitudeDegrees,
          error,
        });
        return null;
      });

    this.cache.set(cacheKey, lookup);
    return lookup;
  }

  private toCacheKey(latitudeDegrees: number, longitudeDegrees: number): string {
    const roundedLat = latitudeDegrees.toFixed(TripLocationLabelService.ROUNDING_PRECISION);
    const roundedLng = longitudeDegrees.toFixed(TripLocationLabelService.ROUNDING_PRECISION);
    return `${roundedLat},${roundedLng}`;
  }

  private async fetchTripLocation(latitudeDegrees: number, longitudeDegrees: number): Promise<ResolvedTripLocationLabel | null> {
    const token = environment.mapboxAccessToken;
    if (!token) {
      this.logger.log('[TripLocationLabelService] Mapbox token missing while resolving trip location.');
      return null;
    }

    // Mapbox reverse geocoding rejects `limit` when multiple `types` are provided.
    const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitudeDegrees},${latitudeDegrees}.json?types=place,locality,district,region,country&access_token=${token}`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      this.logger.log('[TripLocationLabelService] Mapbox geocoding returned non-OK status.', {
        latitudeDegrees,
        longitudeDegrees,
        status: response.status,
      });
      return null;
    }

    const payload = await response.json() as MapboxReverseGeocodingResponse;
    const features = payload.features || [];

    const primaryFeature = features[0] || null;
    const cityFeature = this.findFirstFeatureByType(features, ['place', 'locality', 'district']);
    const countryFeature = this.findFirstFeatureByType(features, ['country']);

    const city = this.normalizeFeatureLabel(cityFeature)
      || this.normalizeContextLabel(this.findFirstContextByType(primaryFeature, ['place', 'locality', 'district']));
    const country = this.normalizeFeatureLabel(countryFeature)
      || this.normalizeContextLabel(this.findFirstContextByType(primaryFeature, ['country']));
    const label = this.composeLabel(city, country);

    const fallbackPath = this.resolveFallbackPath(city, country);
    this.logger.log('[TripLocationLabelService] Parsed trip location label.', {
      latitudeDegrees,
      longitudeDegrees,
      city,
      country,
      label,
      fallbackPath,
    });

    if (!label) return null;

    return {
      city,
      country,
      label,
    };
  }

  private findFirstFeatureByType(features: MapboxFeature[], placeTypes: string[]): MapboxFeature | null {
    for (const placeType of placeTypes) {
      const feature = features.find((candidate) => candidate.place_type?.includes(placeType));
      if (feature) return feature;
    }

    return null;
  }

  private findFirstContextByType(feature: MapboxFeature | null, placeTypes: string[]): MapboxContextFeature | null {
    const contexts = feature?.context || [];
    for (const placeType of placeTypes) {
      const prefix = `${placeType}.`;
      const context = contexts.find((candidate) => candidate.id?.startsWith(prefix));
      if (context) return context;
    }

    return null;
  }

  private normalizeFeatureLabel(feature: MapboxFeature | null): string | null {
    if (!feature) return null;

    const rawLabel = feature.text || feature.place_name;
    if (!rawLabel) return null;

    const normalized = rawLabel.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeContextLabel(context: MapboxContextFeature | null): string | null {
    if (!context?.text) return null;

    const normalized = context.text.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private composeLabel(city: string | null, country: string | null): string | null {
    if (city && country && city.toLowerCase() !== country.toLowerCase()) {
      return `${city}, ${country}`;
    }

    if (country) return country;
    if (city) return city;
    return null;
  }

  private resolveFallbackPath(city: string | null, country: string | null): 'city_country' | 'country_only' | 'city_only' | 'none' {
    if (city && country && city.toLowerCase() !== country.toLowerCase()) {
      return 'city_country';
    }

    if (country) return 'country_only';
    if (city) return 'city_only';
    return 'none';
  }
}
