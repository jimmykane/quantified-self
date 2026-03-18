import { googleAI } from '@genkit-ai/google-genai';
import { genkit } from 'genkit';

export const AI_INSIGHTS_MODEL_NAME = 'gemini-2.5-flash';

export const aiInsightsGenkit = genkit({
  plugins: [
    googleAI(),
  ],
  model: googleAI.model(AI_INSIGHTS_MODEL_NAME),
});
