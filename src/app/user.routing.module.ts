import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { UserComponent } from './components/user/user.component';
import { userResolver } from './resolvers/user.resolver';


const routes: Routes = [
  {
    path: '',
    component: UserComponent,
    resolve: {
      userData: userResolver
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class UserRoutingModule { }
