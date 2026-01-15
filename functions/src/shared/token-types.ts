/**
 * Shared token types for OAuth2 service integrations.
 * These extend the base types from @sports-alliance/sports-lib to handle
 * backend-specific requirements (e.g., Firestore generates `id` on save).
 */
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';

/**
 * Token input type for creating new tokens.
 * Makes `id` optional since Firestore generates it on save.
 */
export type ServiceTokenInput = Omit<Auth2ServiceTokenInterface, 'id'> & { id?: string };
