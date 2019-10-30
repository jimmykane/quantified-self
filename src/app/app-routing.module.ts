import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {HomeComponent} from './components/home/home.component';
import {AppAuthGuard} from './authentication/app.auth.guard';

const routes: Routes = [
  {path: 'home', component: HomeComponent, data: {title: 'Home', animation: 'Home'}},
  {path: 'services', loadChildren: () => import('./modules/services.module').then(module => module.ServicesModule), data: {title: 'Services', animation: 'Services'}},
  // {path: '', redirectTo: 'home', pathMatch: 'full'},
  {path: 'login', loadChildren: () => import('./modules/login.module').then(module => module.LoginModule), data: {title: 'Login', animation: 'Login'}},
  {path: 'dashboard', loadChildren: () => import('./modules/dashboard.module').then(module => module.DashboardModule ), data: {title: 'Dashboard', animation: 'Dashboard'}, canActivate: [AppAuthGuard]},
  {path: 'user/:userID/event/:eventID', loadChildren: () => import('./modules/event.module').then(module => module.EventModule ), data: {title: 'Event Details', animation: 'Event'}},
  {path: 'user/:userID', loadChildren: () => import('./modules/user.module').then(module => module.UserModule), data: {title: 'Profile', animation: 'User'}},
  {path: '**', redirectTo: 'home', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})

export class AppRoutingModule {
}
