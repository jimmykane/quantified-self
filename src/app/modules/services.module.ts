import { NgModule } from '@angular/core';
import {ServicesComponent} from '../components/services/services.component';
import {ServicesRoutingModule} from '../services-routing.module';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    ServicesRoutingModule
  ],
  exports: [
  ],
  declarations: [ServicesComponent],
  providers: [
  ]
})



export class ServicesModule { }
