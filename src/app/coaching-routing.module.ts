import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { AthletesComponent } from './components/athletes/athletes.component';


const routes: Routes = [
  {
    path: '',
    component: AthletesComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CoachingRoutingModule { }
