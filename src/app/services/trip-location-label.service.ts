import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { LoggerService } from './logger.service';

export interface ResolvedTripLocationLabel {
  city: string | null;
  country: string | null;
  label: string | null;
}

export interface TripLocationCoordinateCandidate {
  latitudeDegrees: number;
  longitudeDegrees: number;
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

interface ResolvedLocationVote {
  count: number;
  firstIndex: number;
  location: ResolvedTripLocationLabel;
}

@Injectable({
  providedIn: 'root'
})
export class TripLocationLabelService {
  private static readonly ROUNDING_PRECISION = 2;
  private static readonly MAX_COORDINATE_SAMPLE_COUNT = 5;
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

  public async resolveTripLocationFromCandidates(
    candidates: TripLocationCoordinateCandidate[],
  ): Promise<ResolvedTripLocationLabel | null> {
    const normalizedCandidates = this.normalizeCoordinateCandidates(candidates);
    if (normalizedCandidates.length === 0) {
      return null;
    }

    const sampledCandidates = this.selectCoordinateSamples(normalizedCandidates);
    const resolvedLocations = (await Promise.all(sampledCandidates.map((candidate) => (
      this.resolveTripLocation(candidate.latitudeDegrees, candidate.longitudeDegrees)
    ))))
      .filter((candidate): candidate is ResolvedTripLocationLabel => !!candidate?.label);

    return this.selectBestResolvedLocation(resolvedLocations);
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

    const placeFeature = this.findFirstFeatureByType(features, ['place']);
    const localityFeature = this.findFirstFeatureByType(features, ['locality']);
    const administrativeFeature = this.findFirstFeatureByType(features, ['region', 'district']);
    const countryFeature = this.findFirstFeatureByType(features, ['country']);

    // Prefer a containing place before locality so metro-area districts resolve to the city.
    const city = this.normalizeFeatureLabel(placeFeature)
      || this.normalizeContextLabel(this.findFirstContextByTypeAcrossFeatures(features, ['place']))
      || this.normalizeFeatureLabel(localityFeature)
      || this.normalizeContextLabel(this.findFirstContextByTypeAcrossFeatures(features, ['locality']));
    const administrativeArea = this.normalizeFeatureLabel(administrativeFeature)
      || this.normalizeContextLabel(this.findFirstContextByTypeAcrossFeatures(features, ['region', 'district']));
    const country = this.normalizeFeatureLabel(countryFeature)
      || this.normalizeContextLabel(this.findFirstContextByTypeAcrossFeatures(features, ['country']));
    const label = this.composeLabel(city, administrativeArea, country);

    if (!label) return null;

    return {
      city,
      country,
      label,
    };
  }

  private normalizeCoordinateCandidates(
    candidates: TripLocationCoordinateCandidate[],
  ): TripLocationCoordinateCandidate[] {
    return candidates.filter((candidate) => (
      Number.isFinite(candidate?.latitudeDegrees)
      && Number.isFinite(candidate?.longitudeDegrees)
      && Math.abs(candidate.latitudeDegrees) <= 90
      && Math.abs(candidate.longitudeDegrees) <= 180
    ));
  }

  private selectCoordinateSamples(
    candidates: TripLocationCoordinateCandidate[],
  ): TripLocationCoordinateCandidate[] {
    if (candidates.length <= TripLocationLabelService.MAX_COORDINATE_SAMPLE_COUNT) {
      return candidates;
    }

    const lastIndex = candidates.length - 1;
    const sampleIndexes = new Set<number>();

    for (let sampleIndex = 0; sampleIndex < TripLocationLabelService.MAX_COORDINATE_SAMPLE_COUNT; sampleIndex += 1) {
      sampleIndexes.add(Math.round((sampleIndex * lastIndex) / (TripLocationLabelService.MAX_COORDINATE_SAMPLE_COUNT - 1)));
    }

    return Array.from(sampleIndexes)
      .sort((left, right) => left - right)
      .map((sampleIndex) => candidates[sampleIndex]);
  }

  private selectBestResolvedLocation(
    resolvedLocations: ResolvedTripLocationLabel[],
  ): ResolvedTripLocationLabel | null {
    if (resolvedLocations.length === 0) {
      return null;
    }

    const cityWinner = this.pickWinningLocation(
      resolvedLocations,
      (location) => !!location.city,
    );
    if (cityWinner) {
      return cityWinner;
    }

    const sharedSpecificCity = this.resolveSingleUniqueCity(resolvedLocations);
    if (sharedSpecificCity) {
      return sharedSpecificCity;
    }

    const administrativeWinner = this.pickWinningLocation(
      resolvedLocations,
      (location) => !location.city && !!location.label && (!location.country || !this.labelsMatch(location.label, location.country)),
    );
    if (administrativeWinner) {
      return administrativeWinner;
    }

    const sharedCountry = this.resolveSharedCountry(resolvedLocations);
    if (sharedCountry) {
      return {
        city: null,
        country: sharedCountry,
        label: sharedCountry,
      };
    }

    return resolvedLocations[0];
  }

  private pickWinningLocation(
    resolvedLocations: ResolvedTripLocationLabel[],
    predicate: (location: ResolvedTripLocationLabel) => boolean,
  ): ResolvedTripLocationLabel | null {
    const votes = new Map<string, ResolvedLocationVote>();

    resolvedLocations.forEach((location, index) => {
      if (!location.label || !predicate(location)) {
        return;
      }

      const voteKey = location.label.trim().toLowerCase();
      const currentVote = votes.get(voteKey);
      if (currentVote) {
        currentVote.count += 1;
        return;
      }

      votes.set(voteKey, {
        count: 1,
        firstIndex: index,
        location,
      });
    });

    const rankedVotes = Array.from(votes.values())
      .sort((left, right) => right.count - left.count || left.firstIndex - right.firstIndex);
    const topVote = rankedVotes[0];
    const secondVote = rankedVotes[1];

    if (!topVote) {
      return null;
    }

    const hasClearLead = !secondVote || topVote.count > secondVote.count;
    const hasEnoughSupport = resolvedLocations.length === 1 || topVote.count >= 2;

    return hasClearLead && hasEnoughSupport
      ? topVote.location
      : null;
  }

  private resolveSingleUniqueCity(
    resolvedLocations: ResolvedTripLocationLabel[],
  ): ResolvedTripLocationLabel | null {
    const cityBearingLocations = resolvedLocations.filter((location) => !!location.city);
    if (cityBearingLocations.length === 0) {
      return null;
    }

    const uniqueCityKeys = new Set(
      cityBearingLocations
        .map((location) => location.city?.trim().toLowerCase())
        .filter((city): city is string => !!city),
    );

    return uniqueCityKeys.size === 1
      ? cityBearingLocations[0]
      : null;
  }

  private resolveSharedCountry(resolvedLocations: ResolvedTripLocationLabel[]): string | null {
    let sharedCountry: string | null = null;

    for (const location of resolvedLocations) {
      if (!location.country) {
        continue;
      }

      if (!sharedCountry) {
        sharedCountry = location.country;
        continue;
      }

      if (!this.labelsMatch(sharedCountry, location.country)) {
        return null;
      }
    }

    return sharedCountry;
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

  private findFirstContextByTypeAcrossFeatures(features: MapboxFeature[], placeTypes: string[]): MapboxContextFeature | null {
    for (const feature of features) {
      const context = this.findFirstContextByType(feature, placeTypes);
      if (context) {
        return context;
      }
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

  private composeLabel(city: string | null, administrativeArea: string | null, country: string | null): string | null {
    if (city && country && !this.labelsMatch(city, country)) {
      return `${city}, ${country}`;
    }

    if (city) return city;

    if (administrativeArea && country && !this.labelsMatch(administrativeArea, country)) {
      return `${administrativeArea}, ${country}`;
    }

    if (administrativeArea) return administrativeArea;
    if (country) return country;
    return null;
  }

  private labelsMatch(left: string | null, right: string | null): boolean {
    if (!left || !right) {
      return false;
    }

    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }
}
