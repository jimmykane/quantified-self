import type { PublicSeoPage } from './public-seo-pages.content';
import { PUBLIC_GUIDE_PATHS } from './public-seo-pages.paths';

export const WAHOO_GARMIN_GUIDE_CONTENT: PublicSeoPage = {
  key: 'wahooGarminTrainingData',
  path: PUBLIC_GUIDE_PATHS.wahooGarminTrainingData,
  eyebrow: 'Wahoo + Garmin guide',
  title: 'Analyze Wahoo and Garmin Activities Together',
  description: 'Bring Wahoo and Garmin activities into one Quantified Self history. Explore workouts, performance trends and training load across both sources.',
  h1: 'Analyze Wahoo and Garmin activities together',
  intro: 'Use a Wahoo bike computer and a Garmin watch? Bring recordings from both into one Quantified Self history to explore your workouts, follow performance trends and review your overall training load.',
  accessNote: 'Start free with manual uploads and analysis. Provider connections, automatic imports and supported activity sync require Pro.',
  chips: [
    'Wahoo',
    'Garmin',
    'Activity history',
    'Training analysis'
  ],
  actions: [
    {
      label: 'Analyze my training',
      routerLink: '/login',
      variant: 'flat',
      icon: 'arrow_forward'
    },
    {
      label: 'See Pro options',
      routerLink: '/pricing',
      variant: 'stroked',
      icon: 'arrow_forward'
    },
    {
      label: 'Wahoo + Suunto guide',
      routerLink: '/guides/sync-wahoo-to-suunto',
      variant: 'stroked',
      icon: 'arrow_forward'
    }
  ],
  sections: [
    {
      eyebrow: 'Across your devices',
      title: 'Your activities in one history.',
      copy: 'Review eligible Wahoo-recorded rides and Garmin activities in the same QS account, with the recording source kept visible.',
      items: [
        {
          icon: 'history',
          title: 'One place to explore your workouts',
          copy: 'Review activity details, maps and recorded measurements across the providers you use.'
        },
        {
          icon: 'monitoring',
          title: 'Training load across both sources',
          copy: 'Use Training to understand your overall workload, then explore the sport views and metrics available for your recorded activities.'
        },
        {
          icon: 'directions_bike',
          title: 'A useful setup for cyclists and triathletes',
          copy: 'Keep using Wahoo for rides and Garmin for runs, swims or other sessions. QS brings those recordings into the same history for analysis.'
        }
      ]
    },
    {
      eyebrow: 'Training analysis',
      title: 'Review activities from both sources.',
      copy: 'Explore fitness, fatigue and form across the activities in your QS history. The preview below uses sample data.',
      items: [],
      preview: 'training-hero'
    },
    {
      eyebrow: 'Getting started',
      title: 'Bring both sources into QS.',
      copy: 'Start with your activity files, or use Pro to connect your services for automatic imports.',
      items: [
        {
          icon: 'upload_file',
          title: 'Try it with your own files',
          copy: 'Upload supported activity files from your Wahoo and Garmin sessions on free Starter, within its activity limit.'
        },
        {
          icon: 'link',
          title: 'Connect Wahoo and Garmin with Pro',
          copy: 'Open Connections and authorize both providers. Review the available history options and import any eligible workouts you want to analyze.'
        },
        {
          icon: 'monitoring',
          title: 'Explore your training',
          copy: 'Open Training to review your overall workload or focus on a supported sport. Missing metrics remain unavailable.'
        }
      ]
    },
    {
      eyebrow: 'Activity sync',
      title: 'Choose where your activities go.',
      copy: 'Connecting sources for analysis and delivering activities to another service are separate workflows.',
      items: [
        {
          icon: 'dashboard_customize',
          title: 'Combined analysis in Quantified Self',
          copy: 'This guide combines completed Wahoo and Garmin activities inside QS. It does not send completed Wahoo rides into Garmin Connect or update Garmin training scores.'
        },
        {
          icon: 'sync_alt',
          title: 'Optional Garmin-to-Wahoo activity delivery',
          copy: 'Pro supports eligible Garmin FIT activity delivery to Wahoo after you choose that direction. Use the existing Garmin-to-Wahoo guide for setup and transfer limits.'
        }
      ]
    }
  ],
  faqItems: [
    {
      question: 'Can I use a Wahoo bike computer and Garmin watch together?',
      answer: 'Yes. Quantified Self can import eligible activities from both accounts with Pro, or analyze supported files you upload yourself. You can review the recorded activities in one history and Training workspace.'
    },
    {
      question: 'Does this upload my Wahoo rides to Garmin Connect?',
      answer: 'No. This workflow combines Wahoo and Garmin activities inside Quantified Self. QS does not send completed activities to Garmin Connect or promise changes to Garmin training status, readiness or recovery scores.'
    },
    {
      question: 'Do I need to record a ride on both devices to use QS?',
      answer: 'No. QS can analyze an eligible Wahoo-recorded activity without a second recording from a Garmin watch. The metrics available depend on the data in the recording.'
    },
    {
      question: 'What requires Pro?',
      answer: 'Provider connections, automatic imports and supported activity sync require Pro. Starter includes manual uploads and analysis within its activity limit.'
    },
    {
      question: 'What if I use Suunto or COROS instead?',
      answer: 'Quantified Self also supports Suunto and COROS. Choose the providers and supported files you use, then review their recorded workouts in the same account.'
    }
  ],
  closingTitle: 'Bring your activity history together.',
  closingCopy: 'Start with your recorded workouts, then explore the analysis, maps, comparisons and planning tools in Quantified Self.',
  closingActions: [
    {
      label: 'Start free',
      routerLink: '/login',
      variant: 'flat',
      icon: 'arrow_forward'
    },
    {
      label: 'Wahoo + Suunto',
      routerLink: '/guides/sync-wahoo-to-suunto',
      variant: 'stroked',
      icon: 'arrow_forward'
    },
    {
      label: 'Garmin-to-Wahoo sync guide',
      routerLink: '/guides/sync-garmin-to-wahoo',
      variant: 'stroked',
      icon: 'arrow_forward'
    }
  ],
  freeOfferDescription: 'Starter includes manual uploads and analysis. Wahoo and Garmin connections and automatic imports require Pro.'
};
