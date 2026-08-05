import { googleAI } from '@genkit-ai/google-genai';
import { genkit } from 'genkit';

export const ASSISTANT_MODEL_NAME = 'gemini-3.1-flash-lite';

export const assistantGenkit = genkit({
  plugins: [
    googleAI(),
  ],
  model: googleAI.model(ASSISTANT_MODEL_NAME),
});
