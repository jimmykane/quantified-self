import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ServicesComponent } from './components/services/services.component';
import { userResolver } from './resolvers/user.resolver';


const routes: Routes = [
  {
    path: '',
    component: ServicesComponent,
    resolve: {
      userData: userResolver
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ServicesRoutingModule { }
