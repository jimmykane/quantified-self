import { NgModule } from '@angular/core';
import { ServicesComponent } from '../components/services/services.component';
import { ServicesRoutingModule } from '../services.routing.module';
import { MaterialModule } from './material.module';
import { SharedModule } from './shared.module';
import { CommonModule } from '@angular/common';
import { HistoryImportFormComponent } from '../components/history-import-form/history-import.form.component';
import { UploadRoutesToServiceComponent } from '../components/upload/upload-routes-to-service/upload-routes-to-service.component';
import { ServicesSuuntoComponent } from '../components/services/suunto/services.suunto.component';
import { ServicesGarminComponent } from '../components/services/garmin/services.garmin.component';
import { ServicesCorosComponent } from '../components/services/coros/services.coros.component';
import { ServicesWahooComponent } from '../components/services/wahoo/services.wahoo.component';
import { UploadActivitiesToServiceComponent } from '../components/upload/upload-activities-to-service/upload-activities-to-service.component';
import { ServiceConnectionStatusComponent } from '../components/services/service-connection-status/service-connection-status.component';
import { ActivitySyncRouteControlComponent } from '../components/services/activity-sync-route-control/activity-sync-route-control.component';
import { RouteDeliverySyncRouteControlComponent } from '../components/services/route-delivery-sync-route-control/route-delivery-sync-route-control.component';
import { McpConnectionsComponent } from '../components/mcp-connections/mcp-connections.component';

@NgModule({
    imports: [
        CommonModule,
        SharedModule,
        MaterialModule,
        ServicesRoutingModule,
        McpConnectionsComponent,
    ],
    exports: [],
    declarations: [
        ServicesComponent,
        ServicesSuuntoComponent,
        ServicesGarminComponent,
        ServicesCorosComponent,
        ServicesWahooComponent,
        ServiceConnectionStatusComponent,
        ActivitySyncRouteControlComponent,
        RouteDeliverySyncRouteControlComponent,
        HistoryImportFormComponent,
        UploadRoutesToServiceComponent,
        UploadActivitiesToServiceComponent
    ],
    providers: []
})


export class ServicesModule {
}
