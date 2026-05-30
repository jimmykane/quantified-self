import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { PoliciesComponent } from './components/policies/policies.component';


export const policiesRoutes: Routes = [
  {
    path: '',
    component: PoliciesComponent,
    data: {
      title: 'Privacy Policy & Terms',
      description: 'Read our Privacy Policy, Terms of Service, and Data Protection information.'
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(policiesRoutes)],
  exports: [RouterModule]
})
export class PoliciesRoutingModule { }
