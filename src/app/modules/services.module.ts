import {NgModule} from '@angular/core';
import {ServicesComponent} from '../components/services/services.component';
import {ServicesRoutingModule} from '../services-routing.module';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {HistoryImportFormComponent} from '../components/history-import-form/history-import.form.component';
import { UploadRoutesComponent } from '../components/upload/upload-routes/upload-routes.component';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    ServicesRoutingModule,
  ],
  exports: [],
  declarations: [ServicesComponent, HistoryImportFormComponent, UploadRoutesComponent],
  entryComponents: [],
  providers: []
})


export class ServicesModule {
}
