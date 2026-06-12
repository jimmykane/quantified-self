import { Injectable, inject } from '@angular/core';
import {
  RouteExporterGPX,
  RouteFileInterface,
} from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { AppRouteHydrationService, HydratedRouteFile, RouteHydrationOptions } from './app.route-hydration.service';

export interface RouteGPXExportResult {
  blob: Blob;
  hydratedRoute: HydratedRouteFile;
}

@Injectable({
  providedIn: 'root',
})
export class AppRouteGPXExportService {
  private routeHydrationService = inject(AppRouteHydrationService);

  async getRouteFileAsGPXBlob(routeFile: RouteFileInterface): Promise<Blob> {
    const exporter = new RouteExporterGPX();
    const gpxString = await exporter.getAsString(routeFile);
    return new Blob([gpxString], { type: exporter.fileType });
  }

  async getRouteDocumentAsGPXBlob(
    routeDocument: FirestoreRouteJSON,
    options: RouteHydrationOptions = {},
  ): Promise<RouteGPXExportResult> {
    const hydratedRoute = await this.routeHydrationService.hydrateRouteFile(routeDocument, options);
    const blob = await this.getRouteFileAsGPXBlob(hydratedRoute.routeFile);
    return {
      blob,
      hydratedRoute,
    };
  }
}
