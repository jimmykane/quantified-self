import type { PublicSeoPage, PublicSeoSection } from './public-seo-pages.content';
import { PUBLIC_GUIDE_PATHS } from './public-seo-pages.paths';
import { USAGE_LIMITS } from '@shared/limits';

const STRAVA_EXPORT_HELP = {
  label: 'Strava: export your data',
  url: 'https://support.strava.com/en-us/articles/15401919-how-do-i-export-my-strava-data',
};

const EXPORT_SECTION: PublicSeoSection = {
  eyebrow: '1 · Export from Strava',
  title: 'Download your recordings from Strava',
  copy: 'Use the Strava website on a computer. Quantified Self has no Strava connection; this transfer starts with files you download yourself.',
  items: [
    { icon: 'download', title: 'Request your account download', copy: 'In Strava’s Settings, open My Account. In Download your account, choose Get Started, then Request download. Strava emails the download link; it can take a few hours.' },
    { icon: 'folder_open', title: 'Extract the activity files', copy: 'Unzip the downloaded archive and find the activity recordings. Keep the original files. The account ZIP, activities.csv, photos and other account records are not activity files to upload.' },
    { icon: 'description', title: 'Just one workout?', copy: 'Open your own activity on Strava’s website and choose Export Original from its three-dot menu. The downloaded format depends on the original recording; it is not always FIT.' },
  ],
};

const EXPORT_STEPS = [
  'On Strava’s website, open Settings → My Account → Download your account → Get Started → Request download.',
  'Use Strava’s emailed link, download the archive, and unzip it to find the activity recordings.',
];

function destinationGuide(
  key: 'importStravaToSuunto' | 'importStravaToWahoo' | 'importStravaToCoros',
  destination: 'Suunto' | 'Wahoo' | 'COROS',
  provider: 'suunto' | 'wahoo' | 'coros',
  destinationNote: string,
): PublicSeoPage {
  return {
    key,
    path: PUBLIC_GUIDE_PATHS[key],
    eyebrow: `Strava to ${destination}`,
    title: `Strava to ${destination}: Import Your Activity History`,
    description: `Export your Strava activity files, connect ${destination}, and review a one-time transfer with Quantified Self. Use FIT originals directly or send saved QS activities.`,
    h1: `How to transfer Strava activities to ${destination}`,
    intro: `Bring your Strava history to ${destination} using your exported activity files. Connect ${destination} in Quantified Self, choose the recordings, and review them before sending.`,
    accessNote: 'Connecting the destination and sending activities require Pro. This is a one-time file transfer, not automatic Strava sync.',
    freeOfferDescription: `Manual uploads and analysis are available on Free up to ${USAGE_LIMITS.free} activities. Connecting ${destination} and sending activities require Pro.`,
    chips: ['Strava account export', 'FIT originals', 'Review before sending'],
    actions: [
      { label: 'Get Started', routerLink: '/services', variant: 'flat', icon: 'arrow_forward' },
      { label: 'Upload Help', routerLink: '/help', fragment: 'uploads-and-imports', variant: 'stroked' },
    ],
    sections: [
      EXPORT_SECTION,
      {
        eyebrow: `2 · Send to ${destination}`,
        title: 'Choose files directly or use your QS archive',
        copy: `With Pro, open Connections and connect the ${destination} account that should receive your workouts. Then open Send activities and select ${destination}.`,
        items: [
          { icon: 'upload_file', title: 'Send files directly', copy: 'Choose Local files → Choose FIT files. Select extracted FIT or FIT.gz recordings, up to 50 per batch and 20 MiB per compressed and expanded file. Wait for file preparation, read the review, then confirm Send. If preparation was interrupted, use Review prepared activities to continue. These files are not added to your QS activity archive.' },
          { icon: 'inventory_2', title: 'Or save them to QS first', copy: 'Use Upload on Dashboard to import the activity files into your QS archive. Unpack .gz files first if the file picker does not show them. In Send activities, choose Saved activities, select Uploaded to QS and your dates, then Preview saved activities. Review the eligible originals and confirm Send.' },
          { icon: 'fact_check', title: `Check the result in ${destination}`, copy: `${destinationNote} Recent sends keeps per-file results. Queued and Waiting for provider do not mean Delivered. If the result is uncertain, check the destination before sending another copy.` },
        ],
      },
    ],
    howToSteps: [
      ...EXPORT_STEPS,
      `With Pro, connect ${destination} in Connections and select it in Send activities.`,
      'Choose Local files for FIT or FIT.gz recordings, or upload to QS first and select Saved activities → Uploaded to QS.',
      `Review the selection, confirm Send, then check Recent sends and your ${destination} activity history.`,
    ],
    faqItems: [
      { question: 'Can I upload the whole Strava ZIP or activities.csv?', answer: 'Extract the account archive first and choose individual workout recordings. The account CSV and photos are not supported activity recordings. Keep your export as a backup.' },
      { question: 'What if my Strava export contains GPX or TCX files?', answer: 'You can upload supported GPX and TCX recordings to QS for analysis, subject to your plan’s activity limit. Sending activities to a provider requires an eligible original FIT file. QS does not convert GPX or TCX uploads to FIT for delivery, and changing the filename extension will not make them eligible. Try the original recording from your device or recording service if available.' },
      { question: 'Will every Strava detail transfer?', answer: 'Only the information present in each supported recording can transfer. This workflow does not migrate Strava comments, kudos, segments, photos or the full account archive, and it does not guarantee identical destination statistics. Review a small batch first, especially if workouts already exist in the destination.' },
      { question: 'Will new Strava activities sync automatically?', answer: 'No. There is no Strava connection in QS. Download and send new files yourself when needed. Connecting the destination or confirming this transfer does not turn on ongoing Strava sync.' },
    ],
    sources: [STRAVA_EXPORT_HELP],
    closingTitle: `Bring your recordings to ${destination}`,
    closingCopy: 'Start with a few exported FIT files, review the results, and continue with the rest of your history once they look right.',
    closingActions: [
      { label: 'Get Started', routerLink: '/services', variant: 'flat', icon: 'arrow_forward' },
      { label: 'Send Activities', routerLink: `/send-activities/${provider}`, variant: 'stroked' },
      { label: 'All Guides', routerLink: '/guides', variant: 'stroked' },
    ],
  };
}

export const STRAVA_IMPORT_GUIDE_PAGES = {
  importStravaToSuunto: destinationGuide('importStravaToSuunto', 'Suunto', 'suunto', 'Check that the receiving Suunto account is correct before confirming.'),
  importStravaToWahoo: destinationGuide('importStravaToWahoo', 'Wahoo', 'wahoo', 'Wahoo may continue processing after it accepts an upload.'),
  importStravaToCoros: destinationGuide('importStravaToCoros', 'COROS', 'coros', 'COROS may continue processing after it accepts an upload; some sports can be mapped to a supported destination type, as shown in the review.'),
  importStravaToGarmin: {
    key: 'importStravaToGarmin',
    path: PUBLIC_GUIDE_PATHS.importStravaToGarmin,
    eyebrow: 'Strava to Garmin',
    title: 'Strava to Garmin Connect: Import Your Activity Files',
    description: 'Download your Strava history and import supported FIT, TCX or GPX activity files on Garmin Connect. Learn where Quantified Self fits and what it cannot send.',
    h1: 'How to transfer Strava activities to Garmin Connect',
    intro: 'Export your workouts from Strava, then import the extracted activity files on Garmin Connect’s website. You can also upload a copy to Quantified Self for analysis.',
    accessNote: 'Garmin activity import happens on Garmin Connect. Quantified Self does not send completed activities to Garmin, so you do not need QS Pro or a QS Garmin connection for this transfer.',
    chips: ['Strava account export', 'Garmin file import', 'FIT, TCX or GPX'],
    actions: [
      { label: 'Analyze Your Files', routerLink: '/dashboard', variant: 'flat', icon: 'arrow_forward' },
      { label: 'All Guides', routerLink: '/guides', variant: 'stroked' },
    ],
    sections: [
      EXPORT_SECTION,
      {
        eyebrow: '2 · Import into Garmin Connect',
        title: 'Use Garmin’s activity import on the web',
        copy: 'Sign in to the Garmin Connect account that should receive the workouts. Use its upload icon → Import Data, browse to an extracted activity file, and choose Import.',
        items: [
          { icon: 'description', title: 'Choose supported recordings', copy: 'Garmin documents FIT, TCX and GPX activity imports. GPX recordings need timestamps. Extract any .gz compression first and choose the activity file, not the full Strava account ZIP or CSV. If an archive recording is rejected, try Export Original for that individual activity on Strava.' },
          { icon: 'fact_check', title: 'Verify a small batch first', copy: 'Check the imported workout’s date, sport, map and available sensor data in Garmin Connect before proceeding. Garmin may reject duplicates or incompatible files. Follow Garmin’s current size and data-point limits in the official instructions below.' },
          { icon: 'analytics', title: 'Keep a copy for analysis in QS', copy: `Optionally use Upload on the QS Dashboard to save supported FIT, GPX or TCX recordings for analysis. Free includes up to ${USAGE_LIMITS.free} activities. This does not send them to Garmin, and QS route/course sending is separate from importing completed workouts.` },
        ],
      },
    ],
    howToSteps: [
      ...EXPORT_STEPS,
      'Sign in to Garmin Connect on the web and choose the upload icon → Import Data.',
      'Browse to an extracted FIT, TCX or timestamped GPX activity file and choose Import.',
      'Check the workout in Garmin Connect before importing more; optionally upload a separate copy to QS for analysis.',
    ],
    faqItems: [
      { question: 'Can QS send my Strava workouts to Garmin?', answer: 'No. QS sends completed activities to Suunto, Wahoo and COROS, not Garmin. For Garmin, import the files directly on Garmin Connect. Connecting Garmin to QS does not create an activity-upload destination.' },
      { question: 'Can I use the entire Strava export?', answer: 'Use the bulk export as your source archive, then extract it and import supported individual activity files. Do not upload the full account ZIP or activities.csv. If a recording from the archive fails, export that activity individually from Strava and try its original file.' },
      { question: 'Will Strava features and Garmin training metrics match?', answer: 'Do not expect Strava comments, kudos, segments or photos to transfer with a workout file. Garmin controls which recorded fields and training metrics it accepts or calculates. A successful file import does not guarantee every Garmin device-specific metric.' },
    ],
    sources: [
      STRAVA_EXPORT_HELP,
      { label: 'Garmin: import activity files', url: 'https://support.garmin.com/en-GB/?faq=Ht3ZP52Kju075uKvqTqu99' },
      { label: 'Garmin: fix an activity import', url: 'https://support.garmin.com/en-GB/?faq=j3epr66mmJ0V26Yq0SO6IA' },
    ],
    closingTitle: 'Keep your recordings useful across services',
    closingCopy: 'Import into Garmin Connect directly, and use Quantified Self when you also want to analyze the activity files or keep them alongside recordings from other devices.',
    closingActions: [
      { label: 'Analyze Your Files', routerLink: '/dashboard', variant: 'flat', icon: 'arrow_forward' },
      { label: 'File Analysis', routerLink: '/features/fit-gpx-tcx-file-analyzer', variant: 'stroked' },
      { label: 'All Guides', routerLink: '/guides', variant: 'stroked' },
    ],
  },
} satisfies Record<'importStravaToSuunto' | 'importStravaToGarmin' | 'importStravaToWahoo' | 'importStravaToCoros', PublicSeoPage>;
