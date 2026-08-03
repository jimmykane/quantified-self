import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import type { ResolveData, Routes } from '@angular/router';
import { NetworkAwarePreloadingStrategy } from './resolvers/network-aware-preloading.strategy';
import { authGuard } from './authentication/app.auth.guard';
import { aiInsightsGuard } from './authentication/ai-insights.guard';
import { onboardingGuard } from './authentication/onboarding.guard';
import { adminGuard } from './authentication/admin.guard';
import { pricingRedirectGuard } from './authentication/pricing-redirect.guard';
import { releasesResolver } from './resolvers/releases.resolver';
import { toolsCompareAuthResolver } from './resolvers/tools-compare-auth.resolver';
import { WORKOUT_DATA_COMPARISON_PATH } from './components/features/workout-data-comparison-page.paths';
import {
  PUBLIC_FEATURE_PATHS,
  PUBLIC_GUIDE_PATHS,
} from './components/public-seo/public-seo-pages.paths';
import type { PublicSeoPageKey } from './components/public-seo/public-seo-pages.paths';
import { lazyRouteResolver } from './resolvers/lazy-route.resolver';
import { PublicLayoutComponent } from './components/public-layout/public-layout.component';

const HOME_SEO_DESCRIPTION = 'Analyze Garmin, Suunto, COROS, and Wahoo training in one private dashboard with readiness, load, intensity, durability, sleep, service sync, and read-only MCP access.';
const SEO_RESOLVED_KEYS = ['title', 'description', 'jsonLd'] as const;
const PUBLIC_SEO_RESOLVED_KEYS = [...SEO_RESOLVED_KEYS, 'publicSeoPage'] as const;

type IntegrationProviderKey = 'garmin' | 'suunto' | 'coros' | 'wahoo';

function lazyRouteData<T extends object>(
  loadData: () => Promise<T>,
  keys: readonly (keyof T)[],
): ResolveData {
  return Object.fromEntries(keys.map(key => [
    String(key),
    () => loadData().then(data => data[key]),
  ])) as ResolveData;
}

function integrationHubRouteData(): ResolveData {
  return lazyRouteData(
    () => import('./components/integrations/integration-pages.content')
      .then(module => module.INTEGRATIONS_HUB_ROUTE_DATA),
    SEO_RESOLVED_KEYS,
  );
}

function providerIntegrationRouteData(provider: IntegrationProviderKey): ResolveData {
  return lazyRouteData(
    () => import('./components/integrations/integration-pages.content')
      .then(module => module.PROVIDER_INTEGRATION_ROUTE_DATA[provider]),
    SEO_RESOLVED_KEYS,
  );
}

function workoutDataComparisonRouteData(): ResolveData {
  return lazyRouteData(
    () => import('./components/features/workout-data-comparison-page.content')
      .then(module => module.WORKOUT_DATA_COMPARISON_ROUTE_DATA),
    SEO_RESOLVED_KEYS,
  );
}

function publicSeoRouteData(page: PublicSeoPageKey): ResolveData {
  return lazyRouteData(
    () => import('./components/public-seo/public-seo-pages.content')
      .then(module => module.PUBLIC_SEO_ROUTE_DATA[page]),
    PUBLIC_SEO_RESOLVED_KEYS,
  );
}

const PUBLIC_LAYOUT_ROUTE_PATHS = new Set<string>([
  '',
  '**',
  'pricing',
  'help',
  'releases',
  'policies',
  'privacy',
  'terms',
  'tools',
  'tools/compare',
  'tools/compare/saved',
  'integrations',
  'integrations/garmin',
  'integrations/suunto',
  'integrations/coros',
  'integrations/wahoo',
  WORKOUT_DATA_COMPARISON_PATH,
  ...Object.values(PUBLIC_FEATURE_PATHS),
  ...Object.values(PUBLIC_GUIDE_PATHS),
  'share/event/:userID/:eventID',
  'share/comparison/:userID/:eventID',
]);

const topLevelRoutes: Routes = [
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
    loadComponent: () => import('./components/public-pricing/public-pricing.component').then(m => m.PublicPricingComponent),
    // Public route
    canMatch: [pricingRedirectGuard],
    data: {
      title: 'Membership',
      preload: true,
      description: 'Support the development of Quantified Self. Unlock unlimited activity history and seamless sync for Garmin, Suunto, COROS, and Wahoo while helping keep the project independent.',
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "Quantified Self Membership",
        "description": "Support the development of Quantified Self. Unlock unlimited activity history and seamless sync for Garmin, Suunto, COROS, and Wahoo while helping keep the project independent.",
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
      description: 'Get help with Training analysis, provider imports and sync, Wahoo activity and route delivery, read-only MCP client setup, uploads, billing, privacy, and troubleshooting.',
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "Quantified Self Help & Support",
        "description": "Get help with Training analysis, provider imports and sync, Wahoo activity and route delivery, read-only MCP client setup, uploads, billing, privacy, and troubleshooting.",
        "url": "https://quantified-self.io/help",
        "inLanguage": "en",
        "isPartOf": {
          "@type": "WebSite",
          "name": "Quantified Self",
          "url": "https://quantified-self.io"
        },
        "about": [
          "Training analysis",
          "Assistant",
          "Account setup",
          "Manual uploads",
          "Membership and billing",
          "Garmin to Suunto activity sync",
          "COROS to Suunto activity sync",
          "Wahoo to Suunto activity sync",
          "Send Suunto routes to Garmin",
          "Send Suunto routes to Wahoo",
          "Send GPX/FIT routes to Wahoo",
          "Sync past activities",
          "Read-only MCP client access",
          "Garmin integration",
          "Suunto integration",
          "COROS integration",
          "Wahoo integration",
          "Privacy controls",
          "Troubleshooting"
        ]
      }
    }
  },
  {
    path: 'integrations',
    loadComponent: () => import('./components/integrations/integrations-hub-page.component').then(m => m.IntegrationsHubPageComponent),
    resolve: integrationHubRouteData(),
    data: {
      preload: true,
      animation: 'Integrations',
    },
  },
  {
    path: 'integrations/garmin',
    loadComponent: () => import('./components/integrations/provider-integration-page.component').then(m => m.ProviderIntegrationPageComponent),
    resolve: providerIntegrationRouteData('garmin'),
    data: {
      preload: true,
      animation: 'Integrations',
      integrationProvider: 'garmin',
    },
  },
  {
    path: 'integrations/suunto',
    loadComponent: () => import('./components/integrations/provider-integration-page.component').then(m => m.ProviderIntegrationPageComponent),
    resolve: providerIntegrationRouteData('suunto'),
    data: {
      preload: true,
      animation: 'Integrations',
      integrationProvider: 'suunto',
    },
  },
  {
    path: 'integrations/coros',
    loadComponent: () => import('./components/integrations/provider-integration-page.component').then(m => m.ProviderIntegrationPageComponent),
    resolve: providerIntegrationRouteData('coros'),
    data: {
      preload: true,
      animation: 'Integrations',
      integrationProvider: 'coros',
    },
  },
  {
    path: 'integrations/wahoo',
    loadComponent: () => import('./components/integrations/provider-integration-page.component').then(m => m.ProviderIntegrationPageComponent),
    resolve: providerIntegrationRouteData('wahoo'),
    data: {
      preload: true,
      animation: 'Integrations',
      integrationProvider: 'wahoo',
    },
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
    path: WORKOUT_DATA_COMPARISON_PATH,
    loadComponent: () => import('./components/features/workout-data-comparison-page.component').then(m => m.WorkoutDataComparisonPageComponent),
    resolve: workoutDataComparisonRouteData(),
    data: {
      preload: true,
      animation: 'Features',
    },
  },
  {
    path: PUBLIC_FEATURE_PATHS.hub,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('featuresHub'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
    pathMatch: 'full'
  },
  {
    path: PUBLIC_FEATURE_PATHS.activityCalendar,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('activityCalendar'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_FEATURE_PATHS.trainingAnalysis,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('trainingAnalysis'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_FEATURE_PATHS.mcpServer,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('mcpServer'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_FEATURE_PATHS.aiInsights,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('aiInsights'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_FEATURE_PATHS.workoutFileComparison,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('workoutFileComparison'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_FEATURE_PATHS.fitGpxTcxFileAnalyzer,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('fitGpxTcxFileAnalyzer'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_FEATURE_PATHS.routeFiles,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('routeFiles'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_FEATURE_PATHS.sportsWatchBenchmark,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('sportsWatchBenchmark'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_GUIDE_PATHS.hub,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('guidesHub'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
    pathMatch: 'full'
  },
  {
    path: PUBLIC_GUIDE_PATHS.syncGarminToSuunto,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('syncGarminToSuunto'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_GUIDE_PATHS.syncCorosToSuunto,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('syncCorosToSuunto'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_GUIDE_PATHS.syncWahooToSuunto,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('syncWahooToSuunto'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_GUIDE_PATHS.importActivitiesToSuunto,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('importActivitiesToSuunto'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_GUIDE_PATHS.importActivitiesToWahoo,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('importActivitiesToWahoo'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_GUIDE_PATHS.syncSuuntoRoutesToGarmin,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('syncSuuntoRoutesToGarmin'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: PUBLIC_GUIDE_PATHS.centralizeWorkoutData,
    loadComponent: () => import('./components/public-seo/public-seo-page.component').then(m => m.PublicSeoPageComponent),
    resolve: publicSeoRouteData('centralizeWorkoutData'),
    data: {
      preload: true,
      animation: 'PublicSeo',
    },
  },
  {
    path: 'ai-insights',
    loadComponent: () => import('./components/assistant/assistant-page.component').then(m => m.AssistantPageComponent),
    canMatch: [authGuard, onboardingGuard, aiInsightsGuard],
    data: {
      title: 'Assistant',
      preload: true,
      animation: 'AIInsights',
      description: 'Chat with the built-in Assistant grounded in read-only Quantified Self tools for sleep, readiness, Training, measurements, and activities.',
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
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./modules/dashboard.module').then(module => module.DashboardModule),
    data: { title: 'Dashboard', animation: 'Dashboard', preload: true },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'calendar',
    loadComponent: () => import('./components/calendar/calendar-page/calendar-page.component')
      .then(module => module.CalendarPageComponent),
    data: {
      title: 'Calendar',
      animation: 'Calendar',
      preload: true,
      description: 'Private Week, Month, and Year activity calendar with duration-scaled activity groups and period totals.',
      robots: 'noindex, follow',
    },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'training',
    loadChildren: () => import('./modules/training.module').then(module => module.TrainingModule),
    data: {
      title: 'Training',
      animation: 'Training',
      disableRouteAnimation: true,
      preload: true,
      description: 'Private training analysis for readiness, load trends, intensity, durability, sleep context, and historical build comparisons.',
      robots: 'noindex, follow',
    },
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
    path: 'mcp/authorize',
    loadComponent: () => import('./components/mcp-authorization/mcp-authorization.component')
      .then(module => module.McpAuthorizationComponent),
    data: {
      title: 'Authorize MCP connection',
      robots: 'noindex, nofollow',
    },
    canMatch: [authGuard],
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
    resolve: { route: lazyRouteResolver },
    data: { title: 'Route Details', animation: 'Route' },
    canMatch: [authGuard, onboardingGuard]
  },
  {
    path: 'privacy',
    loadChildren: () => import('./modules/policies.module').then(module => module.PoliciesModule),
    data: {
      title: 'Privacy Policy',
      animation: 'Policies',
      preload: true,
      policyPage: 'privacy',
      description: 'Read how Quantified Self handles personal data, connected services, processors, security, retention, and privacy rights.',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Quantified Self Privacy Policy',
        url: 'https://quantified-self.io/privacy',
        inLanguage: 'en',
      },
    },
  },
  {
    path: 'terms',
    loadChildren: () => import('./modules/policies.module').then(module => module.PoliciesModule),
    data: {
      title: 'Terms of Service',
      animation: 'Policies',
      preload: true,
      policyPage: 'terms',
      description: 'Read the subscription, renewal, cancellation, refund, pricing, and plan terms for Quantified Self.',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Quantified Self Terms of Service',
        url: 'https://quantified-self.io/terms',
        inLanguage: 'en',
      },
    },
  },
  {
    path: 'policies',
    loadChildren: () => import('./modules/policies.module').then(module => module.PoliciesModule),
    data: {
      title: 'Privacy Policy & Terms',
      animation: 'Policies',
      preload: true,
      policyPage: 'all',
      description: 'Read our Privacy Policy, Terms of Service, and Data Protection information.',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Quantified Self Privacy Policy & Terms',
        url: 'https://quantified-self.io/policies',
        inLanguage: 'en',
      },
    },
  },
  {
    path: '',
    loadComponent: () => import('./components/home/home.component').then(component => component.HomeComponent),
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
          "Week, Month, and Year activity calendar with duration-scaled activity groups",
          "Curated training analysis for readiness, load, intensity, durability, sleep context, and best builds",
          "Automatic Garmin to Suunto activity sync",
          "Automatic COROS to Suunto activity sync",
          "Automatic Wahoo to Suunto activity sync",
          "Activity and route delivery to Wahoo",
          "Read-only MCP access for compatible clients",
          "Sync past activities to Suunto by date"
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

/**
 * Public content owns the site footer through this route layout. Keeping
 * workspace and application flows outside the layout prevents marketing
 * chrome from being rendered before a private route has resolved.
 */
export const publicLayoutRoutes = topLevelRoutes.filter(route =>
  route.path !== undefined && PUBLIC_LAYOUT_ROUTE_PATHS.has(route.path)
);

export const routes: Routes = [
  ...topLevelRoutes.filter(route => !publicLayoutRoutes.includes(route)),
  {
    path: '',
    component: PublicLayoutComponent,
    children: publicLayoutRoutes,
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'enabled', preloadingStrategy: NetworkAwarePreloadingStrategy })],
  exports: [RouterModule],
})

export class AppRoutingModule { }
