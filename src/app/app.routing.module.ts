import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { authGuard } from './authentication/app.auth.guard';
import { proGuard } from './authentication/pro.guard';
import { onboardingGuard } from './authentication/onboarding.guard';
import { adminGuard } from './authentication/admin.guard';
import { guestGuard } from './authentication/guest.guard';

const routes: Routes = [
  {
    path: 'login',
    loadChildren: () => import('./modules/login.module').then(module => module.LoginModule),
    data: {
      title: 'Login',
      animation: 'Login',
      description: 'Login to your Quantified Self account to access your dashboard and activity data.',
      keywords: 'quantified self, login, dashboard, activity tracker, fitness data'
    },
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./components/onboarding/onboarding.component').then(m => m.OnboardingComponent),
    canMatch: [authGuard],
    data: { title: 'Welcome' }
  },
  {
    path: 'admin',
    loadChildren: () => import('./modules/admin.module').then(m => m.AdminModule),
    canMatch: [authGuard, adminGuard],
    data: { title: 'Admin Dashboard', animation: 'Admin' }
  },
  {
    path: 'pricing',
    loadComponent: () => import('./components/pricing/pricing.component').then(m => m.PricingComponent),
    // Public route
    data: {
      title: 'Pricing',
      description: 'Choose the right plan for your fitness data analysis needs. Free, Basic, and Pro tiers available.',
      keywords: 'pricing, subscription, fitness analytics, strava alternative, garmin connect alternative'
    }
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
  {
    path: 'services',
    loadChildren: () => import('./modules/services.module').then(module => module.ServicesModule),
    data: { title: 'Services', animation: 'Services' },
    canMatch: [authGuard, onboardingGuard, proGuard]
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./modules/dashboard.module').then(module => module.DashboardModule),
    data: { title: 'Dashboard', animation: 'Dashboard' },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'mytracks',
    loadChildren: () => import('./modules/my-tracks.module').then(module => module.MyTracksModule),
    data: { title: 'MyTracks', animation: 'MyTracks' },
    canMatch: [authGuard, onboardingGuard, proGuard]
  },
  {
    path: 'coaching',
    loadChildren: () => import('./modules/coaching.module').then(module => module.CoachingModule),
    data: { title: 'Coaching', animation: 'Coaching' },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'settings',
    loadChildren: () => import('./modules/user.module').then(module => module.UserModule),
    data: { title: 'Settings', animation: 'User' },
    canMatch: [authGuard, onboardingGuard],
  },
  {
    path: 'user/:userID/dashboard',
    loadChildren: () => import('./modules/dashboard.module').then(module => module.DashboardModule),
    data: { title: `Athlete Dashboard`, animation: 'Dashboard' },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'user/:userID/event/:eventID',
    loadChildren: () => import('./modules/event.module').then(module => module.EventModule),
    data: { title: 'Event Details', animation: 'Event' },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'policies',
    loadChildren: () => import('./modules/policies.module').then(module => module.PoliciesModule),
    data: { title: 'Policies', animation: 'Policies' }
  },
  {
    path: '',
    loadChildren: () => import('./modules/home.module').then(module => module.HomeModule),
    data: {
      title: 'Home',
      animation: 'Home',
      description: 'Quantified Self is a premium analytical tool for your activity data. aggregatde data from Garmin, Suunto, Coros and more.',
      keywords: 'quantified self, fitness tracker, activity analysis, garmin, suunto, coros, strava'
    },
    canMatch: [guestGuard, onboardingGuard],
    pathMatch: 'full'
  },
  { path: '**', redirectTo: '/', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'enabled' })],
  exports: [RouterModule],
})

export class AppRoutingModule { }
