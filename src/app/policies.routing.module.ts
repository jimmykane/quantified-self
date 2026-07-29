import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { PoliciesComponent } from './components/policies/policies.component';


export const policiesRoutes: Routes = [
  {
    path: '',
    component: PoliciesComponent,
  }
];

@NgModule({
  imports: [RouterModule.forChild(policiesRoutes)],
  exports: [RouterModule]
})
export class PoliciesRoutingModule { }
