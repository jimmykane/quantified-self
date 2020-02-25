import {NgModule} from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import { HomeRoutingModule } from '../home-routing.module';
import { HomeComponent } from '../components/home/home.component';

@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    HomeRoutingModule,
  ],
  exports: [],
  declarations: [
    HomeComponent,
  ],
  entryComponents: [],
})


export class HomeModule {
}
