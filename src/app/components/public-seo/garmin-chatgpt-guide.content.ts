import type { PublicSeoPage } from './public-seo-pages.content';
import { PUBLIC_GUIDE_PATHS } from './public-seo-pages.paths';

export const GARMIN_CHATGPT_GUIDE: PublicSeoPage = {
  key: 'garminChatgpt', path: PUBLIC_GUIDE_PATHS.garminChatgpt, eyebrow: 'Cycling analysis',
  title: 'How to analyze your Garmin data with ChatGPT',
  h1: 'How to analyze your Garmin data with ChatGPT',
  description: 'Analyze Garmin rides in ChatGPT with Quantified Self. See a real race debrief, compare training blocks, and copy questions to try with your own records.',
  intro: 'One cyclist logged 22 Garmin rides in four weeks, up from an average of 18. Yet their riding time fell from 33.8 to 29.1 hours. They rode more often, on shorter rides.',
  chips: ['Garmin', 'ChatGPT', 'Cycling'],
  socialImage: 'https://quantified-self.io/assets/images/garmin-chatgpt/garmin-recordings.webp',
  socialImageAlt: 'Garmin cycling recordings over four weeks compared with the previous twelve weeks',
  actions: [{ label: 'Set up ChatGPT in QS', routerLink: '/services', queryParams: { serviceName: 'mcp' }, variant: 'flat' }],
  sections: [
    { eyebrow: 'Garmin recordings', title: 'More rides, fewer hours',
      copy: 'From October 8 to November 4, the rider averaged 79 minutes per recording. In the preceding twelve weeks they averaged 113 minutes. Comparing both periods on a four-week basis shows a 13.8% drop in recorded time.', items: [] },
    { eyebrow: 'From the conversation', title: 'Which rides did ChatGPT count?',
      copy: 'The original answer included two Suunto recordings in the earlier period. Across both devices, riding time fell 14.9%. Checking the recording devices separately gave the Garmin-only figure above. Ask which sources were available when you make your own comparison.', items: [] },
  ],
  howToSteps: [
    'Upload your Garmin FIT files to Quantified Self, or connect Garmin in Connections with Pro. For this comparison, include the latest four weeks and the twelve before them.',
    'Open Connections → MCP in QS and copy the server URL. In a ChatGPT web workspace that supports custom apps, enable developer mode, create an app, paste the URL, and choose OAuth.',
    'Sign in to QS when prompted. Approve Activity and Training metrics for totals. To inspect individual rides and available device details, also approve Individual activity details. Start a new ChatGPT conversation and select Quantified Self.',
  ],
  faqItems: [
    { question: 'Do I need Pro to try this?', answer: 'You can upload activity files on Starter and connect QS to a compatible ChatGPT account. Automatic Garmin imports require QS Pro. Access to custom apps in ChatGPT depends on your ChatGPT plan and workspace settings.' },
    { question: 'What if my history includes more than one device?', answer: 'Ask which recordings were included. Aggregate training totals can combine sources. Ask for a separate Garmin comparison only if the recording device can be identified.' },
    { question: 'What if I have fewer than sixteen weeks of rides?', answer: 'Ask for two shorter periods with known coverage, such as the latest two weeks and the two before them. Ask ChatGPT to flag gaps so you can distinguish an incomplete history from a week off.' },
  ],
  closingTitle: 'Try it with your own rides',
  closingCopy: 'Copy the question and paste it into a ChatGPT conversation with Quantified Self selected.',
  closingActions: [],
};
