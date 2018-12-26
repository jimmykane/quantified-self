import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {DashboardComponent} from './components/dashboard/dashboard.component';
import {AboutComponent} from './components/about/about.component';
import {UploadComponent} from './components/upload/upload.component';
import {EventCardComponent} from './components/cards/event/event.card.component';
import {AppAuthGuard} from './authentication/app.auth.guard';
import {LoginComponent} from './components/login/login.component';

const routes: Routes = [
  {path: '', redirectTo: '/about', pathMatch: 'full'},
  {path: 'login', component: LoginComponent},
  {path: 'dashboard', component: DashboardComponent, canActivate: [AppAuthGuard]},
  {path: 'eventDetails', component: EventCardComponent},
  {path: 'about', component: AboutComponent},
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})

export class AppRoutingModule {
}
