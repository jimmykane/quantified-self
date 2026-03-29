import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from 'app/firebase/auth';
import { environment } from '../../environments/environment';

const { connectAuthEmulatorMock } = vi.hoisted(() => ({
  connectAuthEmulatorMock: vi.fn(),
}));

vi.mock('app/firebase/auth', async () => {
  const actual = await vi.importActual('app/firebase/auth');
  return {
    ...actual,
    connectAuthEmulator: connectAuthEmulatorMock,
  };
});

import { maybeConnectAuthEmulator } from './auth-emulator.config';

describe('maybeConnectAuthEmulator', () => {
  const originalUseAuthEmulator = environment.useAuthEmulator;

  beforeEach(() => {
    connectAuthEmulatorMock.mockReset();
    environment.useAuthEmulator = originalUseAuthEmulator;
  });

  afterAll(() => {
    environment.useAuthEmulator = originalUseAuthEmulator;
  });

  it('should connect to auth emulator when enabled', () => {
    environment.useAuthEmulator = true;
    const mockAuth = {} as Auth;

    const result = maybeConnectAuthEmulator(mockAuth);

    expect(result).toBe(mockAuth);
    expect(connectAuthEmulatorMock).toHaveBeenCalledWith(
      mockAuth,
      'http://localhost:9099',
      { disableWarnings: true }
    );
  });

  it('should not connect to auth emulator when disabled', () => {
    environment.useAuthEmulator = false;
    const mockAuth = {} as Auth;

    const result = maybeConnectAuthEmulator(mockAuth);

    expect(result).toBe(mockAuth);
    expect(connectAuthEmulatorMock).not.toHaveBeenCalled();
  });
});
