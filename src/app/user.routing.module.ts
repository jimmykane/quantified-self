import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { UserComponent } from './components/user/user.component';
import { userResolver } from './resolvers/user.resolver';


export const userRoutes: Routes = [
  {
    path: '',
    component: UserComponent,
    resolve: {
      userData: userResolver
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(userRoutes)],
  exports: [RouterModule]
})
export class UserRoutingModule { }
