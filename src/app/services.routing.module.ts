import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ServicesComponent } from './components/services/services.component';
import { userResolver } from './resolvers/user.resolver';


export const servicesRoutes: Routes = [
  {
    path: '',
    component: ServicesComponent,
    resolve: {
      userData: userResolver
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(servicesRoutes)],
  exports: [RouterModule]
})
export class ServicesRoutingModule { }
