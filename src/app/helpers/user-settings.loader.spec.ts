import { describe, expect, it, vi } from 'vitest';
import { loadUserSettingsUtilities } from './user-settings.loader';

vi.mock('../utils/app.user.utilities', () => { throw new TypeError('Synthetic module fetch failure'); });

describe('account settings module recovery', () => {
  it('classifies a failed module import for page reload recovery and retains the original cause', async () => {
    const failure = await loadUserSettingsUtilities().catch(error => error);
    expect(failure.code).toBe('account/settings-load-failed');
    expect(failure.cause).toBeInstanceOf(Error);
    expect(failure.cause).not.toBe(failure);
  });
});
