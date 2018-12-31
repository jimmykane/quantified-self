import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {DashboardComponent} from './components/dashboard/dashboard.component';
import {HomeComponent} from './components/home/home.component';
import {EventCardComponent} from './components/cards/event/event.card.component';
import {AppAuthGuard} from './authentication/app.auth.guard';
import {LoginComponent} from './components/login/login.component';
import {UserComponent} from './components/user/user.component';

const routes: Routes = [
  {path: 'home', component: HomeComponent, data: {title: 'Home'}},
  // {path: '', redirectTo: 'home', pathMatch: 'full'},
  {path: 'login', component: LoginComponent, data: {title: 'Login'}},
  {path: 'dashboard', component: DashboardComponent, data: {title: 'Dashboard'}, canActivate: [AppAuthGuard]},
  {path: 'user/:userID/event/:eventID', component: EventCardComponent, data: {title: 'Details'}},
  {path: 'user/:userID', component: UserComponent, data: {title: 'User'}},
  {path: '**', redirectTo: 'dashboard', pathMatch: 'full'},
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})

export class AppRoutingModule {
}
