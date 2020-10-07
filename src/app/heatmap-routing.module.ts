import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { HeatmapComponent } from './components/heatmap/heatmap.component';


const routes: Routes = [
  {
    path: '',
    component: HeatmapComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class HeatmapRoutingModule { }
