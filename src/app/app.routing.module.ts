import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NetworkAwarePreloadingStrategy } from './resolvers/network-aware-preloading.strategy';
import { authGuard } from './authentication/app.auth.guard';
import { proGuard } from './authentication/pro.guard';
import { aiInsightsGuard } from './authentication/ai-insights.guard';
import { onboardingGuard } from './authentication/onboarding.guard';
import { adminGuard } from './authentication/admin.guard';
import { pricingRedirectGuard } from './authentication/pricing-redirect.guard';
import { releasesResolver } from './resolvers/releases.resolver';
import { toolsCompareAuthResolver } from './resolvers/tools-compare-auth.resolver';
import { INTEGRATIONS_HUB_ROUTE_DATA, PROVIDER_INTEGRATION_ROUTE_DATA } from './components/integrations/integration-pages.content';
import { WORKOUT_DATA_COMPARISON_ROUTE_DATA } from './components/features/workout-data-comparison-page.content';
import { PUBLIC_FEATURE_PATHS, PUBLIC_GUIDE_PATHS, PUBLIC_SEO_ROUTE_DATA } from './components/public-seo/public-seo-pages.content';
import { routeResolver } from './resolvers/route.resolver';

const HOME_SEO_DESCRIPTION = 'Quantified Self brings Garmin, Suunto, and COROS activity data into one private training dashboard with AI Insights and automatic sync from Garmin or COROS to Suunto.';

export const routes: Routes = [
  {
    path: 'login',
    loadChildren: () => import('./modules/login.module').then(module => module.LoginModule),
    data: {
      title: 'Login',
      animation: 'Login',
      description: 'Login to your Quantified Self account to access your dashboard and activity data.'
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
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "Quantified Self Membership",
        "description": "Support the development of Quantified Self. Unlock unlimited activity history and seamless sync for Suunto, Garmin, and COROS while helping keep the project independent.",
        "url": "https://quantified-self.io/pricing",
        "inLanguage": "en",
        "isPartOf": {
          "@type": "WebSite",
          "name": "Quantified Self",
          "url": "https://quantified-self.io"
        },
        "mainEntity": {
          "@type": "OfferCatalog",
          "name": "Quantified Self memberships",
          "itemListElement": [
            {
              "@type": "Offer",
              "name": "Starter",
              "price": "0",
              "priceCurrency": "USD",
              "description": "Free plan with manual uploads and core analysis tools."
            },
            {
              "@type": "Offer",
              "name": "Basic",
              "description": "Paid membership for higher activity limits and deeper tracking."
            },
            {
              "@type": "Offer",
              "name": "Pro",
              "description": "Paid membership for service connections, cross-service sync, and unlimited tracking."
            }
          ]
        }
      }
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
      description: 'Get help with Garmin -> Suunto and COROS -> Suunto sync routes, Suunto -> Garmin course delivery, catch-up sync, AI Insights, account setup, uploads, billing, privacy, and troubleshooting in Quantified Self.',
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "Quantified Self Help & Support",
        "description": "Get help with Garmin -> Suunto and COROS -> Suunto sync routes, Suunto -> Garmin course delivery, catch-up sync, AI Insights, account setup, uploads, billing, privacy, and troubleshooting in Quantified Self.",
        "url": "https://quantified-self.io/help",
        "inLanguage": "en",
        "isPartOf": {
          "@type": "WebSite",
          "name": "Quantified Self",
          "url": "https://quantified-self.io"
        },
        "about": [
          "AI Insights",
          "Account setup",
          "Manual uploads",
          "Membership and billing",
          "Garmin -> Suunto sync",
          "COROS -> Suunto sync",
          "Suunto -> Garmin course delivery",
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
    path: 'integrations',
    loadComponent: () => import('./components/integrations/integrations-hub-page.component').then(m => m.IntegrationsHubPageComponent),
    data: INTEGRATIONS_HUB_ROUTE_DATA
  },
  {
    path: 'integrations/garmin',
    loadComponent: () => import('./components/integrations/provider-integration-page.component').then(m => m.ProviderIntegrationPageComponent),
    data: {
      ...PROVIDER_INTEGRATION_ROUTE_DATA.garmin,
      integrationProvider: 'garmin'
    }
  },
  {
    path: 'integrations/suunto',
    loadComponent: () => import('./components/integrations/provider-integration-page.component').then(m => m.ProviderIntegrationPageComponent),
    data: {
      ...PROVIDER_INTEGRATION_ROUTE_DATA.suunto,
      integrationProvider: 'suunto'
    }
  },
  {
    path: 'integrations/coros',
    loadComponent: () => import('./components/integrations/provider-integration-page.component').then(m => m.ProviderIntegrationPageComponent),
    data: {
      ...PROVIDER_INTEGRATION_ROUTE_DATA.coros,
      integrationProvider: 'coros'
    }
  },
  {
    path: 'tools',
    loadComponent: () => import('./components/tools/tools-hub-page.component').then(m => m.ToolsHubPageComponent),
    data: {
      title: 'Workout Data Tools',
      preload: true,
      animation: 'Tools',
      description: 'Use Quantified Self tools to compare FIT, GPX, and TCX files, create saved benchmark reports, and review device test results in a private training dashboard.',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Quantified Self Tools',
        description: 'Workout data tools for comparing FIT, GPX, and TCX activity files and reviewing benchmark reports.',
        url: 'https://quantified-self.io/tools',
        inLanguage: 'en',
      },
    },
  },
  {
    path: 'tools/compare',
    loadComponent: () => import('./components/tools/tools-compare-page.component').then(m => m.ToolsComparePageComponent),
    resolve: {
      toolsCompareAuth: toolsCompareAuthResolver,
    },
    data: {
      title: 'FIT, GPX, TCX File Comparison & Benchmark Tool',
      preload: true,
      animation: 'ToolsCompare',
      description: 'Compare FIT, GPX, and TCX workout files, create saved benchmark reports, review GNSS, heart-rate, and altitude metrics, and keep device notes in Quantified Self.',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'FIT, GPX, TCX File Comparison & Benchmark Tool',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web',
        description: 'Create saved benchmark comparisons from FIT, GPX, and TCX workout files with GNSS, heart-rate, and altitude error metrics.',
        url: 'https://quantified-self.io/tools/compare',
        inLanguage: 'en',
        featureList: [
          'Compare FIT, GPX, and TCX workout files',
          'Create saved benchmark events from uploaded files',
          'Review GNSS, heart-rate, and altitude benchmark metrics',
          'Add comparison notes and stable device colors for reviewer workflows',
        ],
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      },
    },
  },
  {
    path: 'tools/compare/saved',
    loadComponent: () => import('./components/tools/tools-compare-page.component').then(m => m.ToolsComparePageComponent),
    resolve: {
      toolsCompareAuth: toolsCompareAuthResolver,
    },
    data: {
      title: 'Saved File Comparisons',
      preload: true,
      animation: 'ToolsCompare',
      defaultTab: 'saved',
      description: 'Open saved benchmark comparisons created from FIT, GPX, and TCX files.',
      robots: 'noindex, follow',
    },
  },
  {
    path: 'features/workout-data-comparison',
    loadComponent: () => import('./components/features/workout-data-comparison-page.component').then(m => m.WorkoutDataComparisonPageComponent),
    data: WORKOUT_DATA_COMPARISON_ROUTE_DATA
  },
  {
    path: PUBLIC_FEATURE_PATHS.hub,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.featuresHub,
    pathMatch: 'full'
  },
  {
    path: PUBLIC_FEATURE_PATHS.aiInsights,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.aiInsights
  },
  {
    path: PUBLIC_FEATURE_PATHS.workoutFileComparison,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.workoutFileComparison
  },
  {
    path: PUBLIC_FEATURE_PATHS.fitGpxTcxFileAnalyzer,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.fitGpxTcxFileAnalyzer
  },
  {
    path: PUBLIC_FEATURE_PATHS.routeFiles,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.routeFiles
  },
  {
    path: PUBLIC_FEATURE_PATHS.sportsWatchBenchmark,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.sportsWatchBenchmark
  },
  {
    path: PUBLIC_GUIDE_PATHS.hub,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.guidesHub,
    pathMatch: 'full'
  },
  {
    path: PUBLIC_GUIDE_PATHS.syncGarminToSuunto,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.syncGarminToSuunto
  },
  {
    path: PUBLIC_GUIDE_PATHS.syncCorosToSuunto,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.syncCorosToSuunto
  },
  {
    path: PUBLIC_GUIDE_PATHS.syncSuuntoRoutesToGarmin,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.syncSuuntoRoutesToGarmin
  },
  {
    path: PUBLIC_GUIDE_PATHS.centralizeWorkoutData,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    data: PUBLIC_SEO_ROUTE_DATA.centralizeWorkoutData
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
    path: 'training',
    loadChildren: () => import('./modules/training.module').then(module => module.TrainingModule),
    data: { title: 'Training', animation: 'Training', preload: true },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'mytracks',
    loadChildren: () => import('./modules/my-tracks.module').then(module => module.MyTracksModule),
    data: { title: 'MyTracks', animation: 'MyTracks', disableRouteAnimation: true, preload: true },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'routes',
    loadComponent: () => import('./components/routes/routes-page.component').then(module => module.RoutesPageComponent),
    data: { title: 'Routes', animation: 'Routes', preload: true, robots: 'noindex, follow' },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'settings',
    loadChildren: () => import('./modules/user.module').then(module => module.UserModule),
    data: { title: 'Settings', animation: 'User', preload: true },
    canMatch: [authGuard, onboardingGuard],
  },
  {
    path: 'share/event/:userID/:eventID',
    loadChildren: () => import('./modules/event.module').then(module => module.EventModule),
    data: {
      title: 'Shared Event',
      animation: 'Event',
      publicShare: true,
      shareKind: 'event',
      robots: 'noindex, nofollow',
    },
  },
  {
    path: 'share/comparison/:userID/:eventID',
    loadChildren: () => import('./modules/event.module').then(module => module.EventModule),
    data: {
      title: 'Shared Comparison',
      animation: 'Event',
      publicShare: true,
      shareKind: 'comparison',
      openBenchmarkOnLoad: true,
      robots: 'noindex, nofollow',
    },
  },
  {
    path: 'user/:userID/event/:eventID',
    loadChildren: () => import('./modules/event.module').then(module => module.EventModule),
    data: { title: 'Event Details', animation: 'Event' },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'user/:userID/route/:routeID',
    loadComponent: () => import('./components/routes/route-detail/route-detail.component').then(module => module.RouteDetailComponent),
    resolve: { route: routeResolver },
    data: { title: 'Route Details', animation: 'Route' },
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
        "url": "https://quantified-self.io/"
      }
    },
    pathMatch: 'full'
  },
  {
    path: '**',
    loadComponent: () => import('./components/not-found/not-found.component').then(m => m.NotFoundComponent),
    data: {
      title: 'Page Not Found',
      description: 'The Quantified Self page you requested could not be found.',
      robots: 'noindex, follow',
    },
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'enabled', preloadingStrategy: NetworkAwarePreloadingStrategy })],
  exports: [RouterModule],
})

export class AppRoutingModule { }
