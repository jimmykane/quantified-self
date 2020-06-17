import {NgModule} from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import { AthletesRoutingModule } from '../athletes-routing.module';
import { AthletesComponent } from '../components/athletes/athletes.component';

@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    AthletesRoutingModule,
  ],
  exports: [],
  declarations: [
    AthletesComponent
  ],
  entryComponents: [],
})


export class AthletesModule {
}
