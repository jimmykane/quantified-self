import {NgModule} from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import { HeatmapRoutingModule } from '../heatmap-routing.module';
import { HeatmapComponent } from '../components/heatmap/heatmap.component';
import { AngularFireStorageModule } from '@angular/fire/storage';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    HeatmapRoutingModule,
    AngularFireStorageModule
  ],
  exports: [],
  declarations: [HeatmapComponent],
  entryComponents: [],
  providers: []
})

export class HeatmapModule {
}
