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
import { UploadActivitiesToServiceComponent } from '../components/upload/upload-activities-to-service/upload-activities-to-service.component';


@NgModule({
    imports: [
        CommonModule,
        SharedModule,
        MaterialModule,
        ServicesRoutingModule
    ],
    exports: [],
    declarations: [
        ServicesComponent,
        ServicesSuuntoComponent,
        ServicesGarminComponent,
        ServicesCorosComponent,
        HistoryImportFormComponent,
        UploadRoutesToServiceComponent,
        UploadActivitiesToServiceComponent
    ],
    providers: []
})


export class ServicesModule {
}
