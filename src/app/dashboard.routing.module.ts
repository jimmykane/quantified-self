import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { dashboardResolver } from './resolvers/dashboard.resolver';


const routes: Routes = [
  {
    path: '',
    component: DashboardComponent,
    resolve: {
      dashboardData: dashboardResolver
    },
    data: { title: 'Dashboard' }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class DashboardRoutingModule { }
