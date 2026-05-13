import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NetworkAwarePreloadingStrategy } from './resolvers/network-aware-preloading.strategy';
import { authGuard } from './authentication/app.auth.guard';
import { proGuard } from './authentication/pro.guard';
import { aiInsightsGuard } from './authentication/ai-insights.guard';
import { onboardingGuard } from './authentication/onboarding.guard';
import { adminGuard } from './authentication/admin.guard';
import { loggedInGuard } from './authentication/logged-in.guard';
import { pricingRedirectGuard } from './authentication/pricing-redirect.guard';
import { releasesResolver } from './resolvers/releases.resolver';

const HOME_SEO_DESCRIPTION = 'Quantified Self brings Garmin, Suunto, and COROS activity data into one private training dashboard with AI Insights and automatic sync from Garmin or COROS to Suunto.';

export const routes: Routes = [
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
    canMatch: [pricingRedirectGuard],
    data: {
      title: 'Membership',
      preload: true,
      description: 'Support the development of Quantified Self. Unlock unlimited activity history and seamless sync for Suunto, Garmin, and COROS while helping keep the project independent.',
      keywords: 'support, membership, fitness analytics, suunto sync, garmin connect sync, coros integration, independent software'
    }
  },
  {
    path: 'subscriptions',
    loadComponent: () => import('./components/pricing/pricing.component').then(m => m.PricingComponent),
    canMatch: [authGuard],
    data: {
      title: 'Subscription',
      preload: true
    }
  },
  {
    path: 'payment/success',
    loadComponent: () => import('./components/payment-success/payment-success.component').then(m => m.PaymentSuccessComponent),
    canMatch: [authGuard],
    data: { title: 'Payment Success' }
  },
  {
    path: 'help',
    loadComponent: () => import('./components/help/help-page.component').then(m => m.HelpPageComponent),
    data: {
      title: 'Help & Support',
      preload: true,
      animation: 'Help',
      description: 'Get help with Garmin -> Suunto and COROS -> Suunto sync routes, catch-up sync, AI Insights, account setup, uploads, billing, privacy, and troubleshooting in Quantified Self.',
      keywords: 'help, support, faq, garmin to suunto sync, coros to suunto sync, catch-up sync, ai insights, uploads, billing, privacy, quantified self',
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "Quantified Self Help & Support",
        "description": "Get help with Garmin -> Suunto and COROS -> Suunto sync routes, catch-up sync, AI Insights, account setup, uploads, billing, privacy, and troubleshooting in Quantified Self.",
        "url": "https://www.quantified-self.io/help",
        "inLanguage": "en",
        "isPartOf": {
          "@type": "WebSite",
          "name": "Quantified Self",
          "url": "https://www.quantified-self.io"
        },
        "about": [
          "AI Insights",
          "Account setup",
          "Manual uploads",
          "Membership and billing",
          "Garmin -> Suunto sync",
          "COROS -> Suunto sync",
          "Catch-up sync",
          "Garmin integration",
          "Suunto integration",
          "COROS integration",
          "Privacy controls",
          "Troubleshooting"
        ]
      }
    }
  },
  {
    path: 'ai-insights',
    loadComponent: () => import('./components/ai-insights/ai-insights-page.component').then(m => m.AiInsightsPageComponent),
    canMatch: [authGuard, onboardingGuard, aiInsightsGuard],
    data: {
      title: 'AI Insights',
      preload: true,
      animation: 'AIInsights',
      description: 'Ask focused questions about your training data and get one AI summary with one chart built from your persisted event statistics.',
      keywords: 'ai insights, fitness analytics, training insights, cadence trends, activity charts, quantified self',
    }
  },
  {
    path: 'releases',
    loadComponent: () => import('./components/whats-new/whats-new-page.component').then(m => m.WhatsNewPageComponent),
    resolve: { releases: releasesResolver },
    data: {
      title: 'Release Notes',
      preload: true,
      animation: 'Releases',
      description: 'Stay up to date with the latest features, improvements, and bug fixes in Quantified Self.',
      keywords: 'release notes, changelog, updates, new features, quantified self updates',
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Quantified Self Release Notes",
        "description": "Chronological list of updates and changes to the Quantified Self application.",
        "itemListElement": [] // We could populate this dynamically if we were rendering on server, but static metadata is better than nothing for the list page itself.
      }
    }
  },
  {
    path: 'payment/cancel',
    loadComponent: () => import('./components/payment-cancel/payment-cancel.component').then(m => m.PaymentCancelComponent),
    canMatch: [authGuard, onboardingGuard],
    data: { title: 'Payment Cancelled' }
  },
  {
    path: 'services',
    loadChildren: () => import('./modules/services.module').then(module => module.ServicesModule),
    data: { title: 'Services', animation: 'Services', preload: true },
    canMatch: [authGuard, onboardingGuard, proGuard]
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./modules/dashboard.module').then(module => module.DashboardModule),
    data: { title: 'Dashboard', animation: 'Dashboard', preload: true },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'mytracks',
    loadChildren: () => import('./modules/my-tracks.module').then(module => module.MyTracksModule),
    data: { title: 'MyTracks', animation: 'MyTracks', preload: true },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'settings',
    loadChildren: () => import('./modules/user.module').then(module => module.UserModule),
    data: { title: 'Settings', animation: 'User', preload: true },
    canMatch: [authGuard, onboardingGuard],
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
    data: { title: 'Policies', animation: 'Policies', preload: true }
  },
  {
    path: '',
    loadChildren: () => import('./modules/home.module').then(module => module.HomeModule),
    data: {
      animation: 'Home',
      description: HOME_SEO_DESCRIPTION,
      keywords: 'quantified self, ai insights, performance analytics, training analytics, garmin connect sync, suunto app, garmin to suunto sync, coros to suunto sync, automatic sync between services, catch-up sync',
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "Quantified Self",
        "applicationCategory": "HealthApplication",
        "operatingSystem": "Web",
        "description": HOME_SEO_DESCRIPTION,
        "featureList": [
          "AI Insights with chart-backed answers",
          "Automatic Garmin -> Suunto sync for newly imported Garmin activities",
          "Automatic COROS -> Suunto sync for newly imported COROS activities",
          "Manual catch-up sync for events already stored in Quantified Self"
        ],
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD"
        },
        "url": "https://www.quantified-self.io/"
      }
    },
    canMatch: [loggedInGuard, onboardingGuard],
    pathMatch: 'full'
  },
  { path: '**', redirectTo: '/', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'enabled', preloadingStrategy: NetworkAwarePreloadingStrategy })],
  exports: [RouterModule],
})

export class AppRoutingModule { }
