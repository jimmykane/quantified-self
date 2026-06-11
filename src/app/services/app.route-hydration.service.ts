import { Injectable, inject } from '@angular/core';
import {
  RouteFileInterface,
  RouteImporterFIT,
  RouteImporterGPX,
  RouteInterface,
  RouteParsingOptions,
} from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '@shared/app-route.interface';
import { createRouteParsingOptions } from '@shared/parsing-options';
import { AppFileService } from './app.file.service';
import { AppRouteService } from './app.route.service';

export interface RouteHydrationOptions {
  streamTypes?: string[];
  metadataCacheTtlMs?: number;
}

export interface HydratedRouteFile {
  routeDocument: FirestoreRouteJSON;
  routeFile: RouteFileInterface;
  sourceFile: OriginalRouteFileMetaData;
}

@Injectable({
  providedIn: 'root',
})
export class AppRouteHydrationService {
  private routeService = inject(AppRouteService);
  private fileService = inject(AppFileService);

  async hydrateRouteFile(
    routeDocument: FirestoreRouteJSON,
    options: RouteHydrationOptions = {},
  ): Promise<HydratedRouteFile> {
    const sourceFile = this.resolvePrimarySourceFile(routeDocument);
    const extension = this.resolveSourceExtension(routeDocument, sourceFile);
    const buffer = await this.routeService.downloadFile(sourceFile.path, {
      metadataCacheTtlMs: options.metadataCacheTtlMs,
    });
    const routeFile = await this.parseRouteFile(buffer, extension, routeDocument, options.streamTypes);
    this.applyStoredRouteIdentity(routeDocument, routeFile);

    return {
      routeDocument,
      routeFile,
      sourceFile,
    };
  }

  private resolvePrimarySourceFile(routeDocument: FirestoreRouteJSON): OriginalRouteFileMetaData {
    const originalFiles = this.routeService.getOriginalRouteFiles(routeDocument);
    const sourceFile = originalFiles[0];
    if (!sourceFile?.path) {
      throw new Error('Saved route is missing its original source file.');
    }
    return sourceFile;
  }

  private resolveSourceExtension(
    routeDocument: FirestoreRouteJSON,
    sourceFile: OriginalRouteFileMetaData,
  ): string {
    const extension = this.fileService
      .getExtensionFromPath(sourceFile.path, sourceFile.extension || routeDocument.srcFileType || '')
      .toLowerCase();
    if (!extension) {
      throw new Error('Saved route source file has no supported extension.');
    }
    return extension;
  }

  private async parseRouteFile(
    buffer: ArrayBuffer,
    extension: string,
    routeDocument: FirestoreRouteJSON,
    streamTypes?: string[],
  ): Promise<RouteFileInterface> {
    const parseOptions = createRouteParsingOptions({}, streamTypes) as RouteParsingOptions;
    const routeName = routeDocument.name || routeDocument.id || 'Saved route';

    switch (extension) {
      case 'gpx': {
        const gpxText = new TextDecoder().decode(buffer);
        const domParser = typeof DOMParser !== 'undefined' ? DOMParser : undefined;
        return RouteImporterGPX.getFromString(gpxText, domParser, parseOptions, routeName);
      }
      case 'fit':
        return RouteImporterFIT.getFromArrayBuffer(buffer, parseOptions, routeName);
      default:
        throw new Error(`Unsupported route source file type: ${extension}`);
    }
  }

  private applyStoredRouteIdentity(routeDocument: FirestoreRouteJSON, routeFile: RouteFileInterface): void {
    this.applySavedRouteName(routeDocument, routeFile);

    if (routeDocument.id && typeof routeFile.setID === 'function') {
      routeFile.setID(routeDocument.id);
    }

    const parsedRoutes = routeFile.getRoutes?.() || [];
    const storedRoutes = Array.isArray(routeDocument.routes) ? routeDocument.routes : [];
    const storedRoutesById = new Map(
      storedRoutes
        .filter(storedRoute => !!storedRoute?.id)
        .map(storedRoute => [storedRoute.id as string, storedRoute]),
    );
    const assignedStoredIndexes = new Set<number>();

    parsedRoutes.forEach((parsedRoute, parsedIndex) => {
      const parsedId = parsedRoute.getID?.();
      const matchedStoredRoute = parsedId ? storedRoutesById.get(parsedId) : null;
      const matchedIndex = matchedStoredRoute
        ? storedRoutes.findIndex(storedRoute => storedRoute.id === matchedStoredRoute.id)
        : parsedIndex;
      const storedRoute = matchedStoredRoute || storedRoutes[parsedIndex];

      if (matchedIndex >= 0) {
        assignedStoredIndexes.add(matchedIndex);
      }
      this.applyRouteSegmentIdentity(parsedRoute, storedRoute?.id);
    });

    parsedRoutes.forEach((parsedRoute, parsedIndex) => {
      if (parsedRoute.getID?.()) {
        return;
      }
      const fallbackStoredIndex = storedRoutes.findIndex((_storedRoute, storedIndex) => !assignedStoredIndexes.has(storedIndex));
      const fallbackStoredRoute = fallbackStoredIndex >= 0 ? storedRoutes[fallbackStoredIndex] : storedRoutes[parsedIndex];
      if (fallbackStoredIndex >= 0) {
        assignedStoredIndexes.add(fallbackStoredIndex);
      }
      this.applyRouteSegmentIdentity(parsedRoute, fallbackStoredRoute?.id);
    });
  }

  private applySavedRouteName(routeDocument: FirestoreRouteJSON, routeFile: RouteFileInterface): void {
    const storedRouteName = typeof routeDocument.name === 'string' ? routeDocument.name.trim() : '';
    if (!storedRouteName) {
      return;
    }

    routeFile.name = storedRouteName;

    const parsedRoutes = routeFile.getRoutes?.() || [];
    if (parsedRoutes.length === 1) {
      parsedRoutes[0].name = storedRouteName;
    }
  }

  private applyRouteSegmentIdentity(route: RouteInterface, id: string | null | undefined): void {
    if (id && typeof route.setID === 'function') {
      route.setID(id);
    }
  }
}
