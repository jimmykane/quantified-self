import { googleAI } from '@genkit-ai/google-genai';
import { genkit } from 'genkit';

export const AI_INSIGHTS_MODEL_NAME = 'gemini-3.1-flash-lite';

export const aiInsightsGenkit = genkit({
  plugins: [
    googleAI(),
  ],
  model: googleAI.model(AI_INSIGHTS_MODEL_NAME),
});
