import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { authGuard } from './authentication/app.auth.guard';
import { premiumGuard } from './authentication/premium.guard';

const routes: Routes = [
  {
    path: 'services',
    loadChildren: () => import('./modules/services.module').then(module => module.ServicesModule),
    data: { title: 'Services', animation: 'Services' },
    canMatch: [authGuard, premiumGuard]
  },
  {
    path: '',
    loadChildren: () => import('./modules/home.module').then(module => module.HomeModule),
    data: { title: 'Home', animation: 'Home' }
  },
  {
    path: 'login',
    loadChildren: () => import('./modules/login.module').then(module => module.LoginModule),
    data: { title: 'Login', animation: 'Login' },
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./modules/dashboard.module').then(module => module.DashboardModule),
    data: { title: 'Dashboard', animation: 'Dashboard' },
    canMatch: [authGuard, premiumGuard]
  },
  {
    path: 'mytracks',
    loadChildren: () => import('./modules/my-tracks.module').then(module => module.MyTracksModule),
    data: { title: 'MyTracks', animation: 'MyTracks' },
    canMatch: [authGuard, premiumGuard]
  },
  {
    path: 'coaching',
    loadChildren: () => import('./modules/coaching.module').then(module => module.CoachingModule),
    data: { title: 'Coaching', animation: 'Coaching' },
    canMatch: [authGuard, premiumGuard]
  },
  {
    path: 'settings',
    loadChildren: () => import('./modules/user.module').then(module => module.UserModule),
    data: { title: 'Settings', animation: 'User' },
    canMatch: [authGuard, premiumGuard],
  },
  {
    path: 'user/:userID/dashboard',
    loadChildren: () => import('./modules/dashboard.module').then(module => module.DashboardModule),
    data: { title: `Athlete Dashboard`, animation: 'Dashboard' },
    canMatch: [authGuard, premiumGuard]
  },
  {
    path: 'user/:userID/event/:eventID',
    loadChildren: () => import('./modules/event.module').then(module => module.EventModule),
    data: { title: 'Event Details', animation: 'Event' },
    canMatch: [authGuard, premiumGuard]
  },
  {
    path: 'policies',
    loadChildren: () => import('./modules/policies.module').then(module => module.PoliciesModule),
    data: { title: 'Policies', animation: 'Policies' }
  },
  {
    path: 'pricing',
    loadComponent: () => import('./components/pricing/pricing.component').then(m => m.PricingComponent),
    canMatch: [authGuard],
    data: { title: 'Pricing' }
  },
  {
    path: 'payment/success',
    loadComponent: () => import('./components/payment-success/payment-success.component').then(m => m.PaymentSuccessComponent),
    canMatch: [authGuard],
    data: { title: 'Payment Success' }
  },
  {
    path: 'payment/cancel',
    loadComponent: () => import('./components/payment-cancel/payment-cancel.component').then(m => m.PaymentCancelComponent),
    canMatch: [authGuard],
    data: { title: 'Payment Cancelled' }
  },
  { path: '**', redirectTo: '/', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'enabled' })],
  exports: [RouterModule],
})

export class AppRoutingModule {
}
