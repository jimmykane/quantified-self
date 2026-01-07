import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { PoliciesComponent } from './components/policies/policies.component';


const routes: Routes = [
  {
    path: '',
    component: PoliciesComponent,
    data: {
      title: 'Privacy Policy & Terms',
      description: 'Read our Privacy Policy, Terms of Service, and Data Protection information.',
      keywords: 'privacy policy, terms of service, gdpr, data protection, security'
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PoliciesRoutingModule { }
