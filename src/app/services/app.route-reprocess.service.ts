import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';

import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { ROUTE_DETAIL_STREAM_TYPES, RouteResolverData } from '../resolvers/route.resolver';
import { AppFunctionsService } from './app.functions.service';
import { AppRouteHydrationService } from './app.route-hydration.service';
import { AppRouteService } from './app.route.service';

export type RouteReprocessPhase =
  | 'validating'
  | 'downloading'
  | 'parsing'
  | 'regenerating_stats'
  | 'persisting'
  | 'done';

export interface RouteReprocessProgress {
  phase: RouteReprocessPhase;
  progress: number;
  details?: string;
}

export interface RouteReprocessOptions {
  onProgress?: (progress: RouteReprocessProgress) => void;
}

export interface RouteReprocessResult extends RouteResolverData {
  sourceFilesCount: number;
  routeCount: number;
  waypointCount: number;
  pointCount: number;
}

export interface RouteReprocessDocumentResult {
  routeDocument: FirestoreRouteJSON;
  sourceFilesCount: number;
  routeCount: number;
  waypointCount: number;
  pointCount: number;
}

export type RouteReprocessErrorCode =
  | 'NO_ORIGINAL_FILES'
  | 'PARSE_FAILED'
  | 'PERSIST_FAILED'
  | 'ACCOUNT_DELETING'
  | 'SERVICE_UNAVAILABLE';

export class RouteReprocessError extends Error {
  constructor(
    public code: RouteReprocessErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'RouteReprocessError';
  }
}

export function getRouteReprocessProgressTitle(phase: RouteReprocessPhase): string {
  switch (phase) {
    case 'validating':
      return 'Validating route source...';
    case 'downloading':
      return 'Downloading route source...';
    case 'parsing':
      return 'Parsing route...';
    case 'regenerating_stats':
      return 'Generating route statistics...';
    case 'persisting':
      return 'Saving route...';
    case 'done':
      return 'Done';
    default:
      return 'Processing route...';
  }
}

export function getRouteReprocessErrorMessage(error: unknown): string {
  if (error instanceof RouteReprocessError) {
    if (error.code === 'NO_ORIGINAL_FILES') {
      return 'No original route file found.';
    }
    if (error.code === 'PERSIST_FAILED') {
      return 'Could not load the updated route after reprocessing.';
    }
    if (error.code === 'PARSE_FAILED') {
      return 'Could not parse the original route source file.';
    }
    if (error.code === 'ACCOUNT_DELETING') {
      return 'Account deletion is in progress. Route reprocess is unavailable.';
    }
    if (error.code === 'SERVICE_UNAVAILABLE') {
      return 'Route reprocess service is temporarily unavailable. Please try again shortly.';
    }
  }
  return 'Could not reprocess route from source file.';
}

interface ReprocessRouteFunctionResponse {
  routeId: string;
  status: 'completed' | 'skipped';
  reason?: 'NO_ORIGINAL_FILES';
  sourceFilesCount: number;
  routeCount: number;
  waypointCount: number;
  pointCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class AppRouteReprocessService {
  private routeService = inject(AppRouteService);
  private routeHydrationService = inject(AppRouteHydrationService);
  private functionsService = inject(AppFunctionsService);

  public async reprocessRouteDocumentFromOriginalFile(
    user: User,
    routeDocument: FirestoreRouteJSON,
    options?: RouteReprocessOptions,
  ): Promise<RouteReprocessDocumentResult> {
    const reprocessResult = await this.reprocessRouteFunctionAndRefreshDocument(user, routeDocument, options);
    this.notifyProgress(options, { phase: 'done', progress: 100, details: 'Done' });
    return reprocessResult;
  }

  public async reprocessRouteFromOriginalFile(
    user: User,
    routeDocument: FirestoreRouteJSON,
    options?: RouteReprocessOptions,
  ): Promise<RouteReprocessResult> {
    const reprocessResult = await this.reprocessRouteFunctionAndRefreshDocument(user, routeDocument, options);
    const hydratedRoute = await this.routeHydrationService.hydrateRouteFile(reprocessResult.routeDocument, {
      streamTypes: [...ROUTE_DETAIL_STREAM_TYPES],
    });
    this.notifyProgress(options, { phase: 'done', progress: 100, details: 'Done' });

    return {
      routeDocument: hydratedRoute.routeDocument,
      routeFile: hydratedRoute.routeFile,
      sourceFile: hydratedRoute.sourceFile,
      user,
      sourceFilesCount: reprocessResult.sourceFilesCount,
      routeCount: reprocessResult.routeCount,
      waypointCount: reprocessResult.waypointCount,
      pointCount: reprocessResult.pointCount,
    };
  }

  private async reprocessRouteFunctionAndRefreshDocument(
    user: User,
    routeDocument: FirestoreRouteJSON,
    options?: RouteReprocessOptions,
  ): Promise<RouteReprocessDocumentResult> {
    const routeId = routeDocument.id;
    if (!routeId) {
      throw new RouteReprocessError('PARSE_FAILED', 'Route ID is missing and cannot be reprocessed.');
    }

    if (this.routeService.getOriginalRouteFiles(routeDocument).length === 0) {
      throw new RouteReprocessError('NO_ORIGINAL_FILES', 'No original source file metadata found for this route.');
    }

    this.getProgressPlan().forEach(progress => this.notifyProgress(options, progress));

    let functionResult: ReprocessRouteFunctionResponse;
    try {
      const response = await this.functionsService.call<
        { routeId: string },
        ReprocessRouteFunctionResponse
      >('reprocessRoute', { routeId });
      functionResult = response.data;
    } catch (error) {
      throw this.mapFunctionError(error);
    }

    if (functionResult.status === 'skipped' && functionResult.reason === 'NO_ORIGINAL_FILES') {
      throw new RouteReprocessError('NO_ORIGINAL_FILES', 'No original source file metadata found for this route.');
    }

    const refreshedRouteDocument = await firstValueFrom(this.routeService.getRoute(user, routeId));
    if (!refreshedRouteDocument) {
      throw new RouteReprocessError('PERSIST_FAILED', 'Could not load updated route after reprocessing.');
    }

    return {
      routeDocument: refreshedRouteDocument,
      sourceFilesCount: functionResult.sourceFilesCount,
      routeCount: functionResult.routeCount,
      waypointCount: functionResult.waypointCount,
      pointCount: functionResult.pointCount,
    };
  }

  private mapFunctionError(error: unknown): RouteReprocessError {
    const code = `${(error as { code?: unknown })?.code || ''}`;
    const message = `${(error as { message?: unknown })?.message || (error instanceof Error ? error.message : error) || ''}`.trim();
    if (message.includes('NO_ORIGINAL_FILES')) {
      return new RouteReprocessError('NO_ORIGINAL_FILES', 'No original source file metadata found for this route.', error);
    }
    if (code.includes('failed-precondition') && /account is being deleted|account deletion|no longer exists/i.test(message)) {
      return new RouteReprocessError('ACCOUNT_DELETING', message || 'Account deletion is in progress.', error);
    }
    if (code.includes('unavailable') || message.includes('Could not verify account state')) {
      return new RouteReprocessError(
        'SERVICE_UNAVAILABLE',
        message || 'Route reprocess service is temporarily unavailable.',
        error,
      );
    }
    return new RouteReprocessError('PARSE_FAILED', 'Could not parse the original route source file.', error);
  }

  private notifyProgress(options: RouteReprocessOptions | undefined, progress: RouteReprocessProgress): void {
    options?.onProgress?.(progress);
  }

  private getProgressPlan(): RouteReprocessProgress[] {
    return [
      { phase: 'validating', progress: 5, details: 'Validating source file' },
      { phase: 'downloading', progress: 20, details: 'Downloading source file' },
      { phase: 'parsing', progress: 45, details: 'Parsing route' },
      { phase: 'regenerating_stats', progress: 70, details: 'Generating route statistics' },
      { phase: 'persisting', progress: 90, details: 'Saving updated route' },
    ];
  }
}
