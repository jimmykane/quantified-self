import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { TracksComponent } from './components/tracks/tracks.component';


export const myTracksRoutes: Routes = [
  {
    path: '',
    component: TracksComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(myTracksRoutes)],
  exports: [RouterModule]
})
export class MyTracksRoutingModule { }
