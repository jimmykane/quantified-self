import {NgModule} from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import { HeatmapRoutingModule } from '../heatmap-routing.module';
import { HeatmapComponent } from '../components/heatmap/heatmap.component';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    HeatmapRoutingModule,
  ],
  exports: [],
  declarations: [HeatmapComponent],
  entryComponents: [],
  providers: []
})

export class HeatmapModule {
}
