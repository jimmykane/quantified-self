import {NgModule} from '@angular/core';
import {ServicesComponent} from '../components/services/services.component';
import {ServicesRoutingModule} from '../services-routing.module';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {HistoryImportFormComponent} from '../components/history-import-form/history-import.form.component';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    ServicesRoutingModule,
  ],
  exports: [],
  declarations: [ServicesComponent, HistoryImportFormComponent],
  entryComponents: [HistoryImportFormComponent],
  providers: []
})


export class ServicesModule {
}
