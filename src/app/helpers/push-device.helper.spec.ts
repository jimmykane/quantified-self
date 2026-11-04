import { describe, expect, it } from 'vitest';
import { pushDeviceInfo } from './push-device.helper';
import { isPushDeviceInfo } from '@shared/web-push';

describe('notification device display hints', () => {
  it.each([
    ['Macintosh Chrome/131 Safari/537', 'MacIntel', 0, 'Chrome', 'macOS'],
    ['Windows Chrome/131 Safari/537 Edg/131', 'Win32', 0, 'Edge', 'Windows'],
    ['Android Chrome/131 SamsungBrowser/26', 'Linux', 5, 'Samsung Internet', 'Android'],
    ['Android Chrome/131 OPR/90', 'Linux', 5, 'Opera', 'Android'],
    ['iPhone CriOS/131 Safari/605', 'iPhone', 5, 'Chrome', 'iOS'],
    ['Macintosh Version/18 Safari/605', 'MacIntel', 5, 'Safari', 'iOS'],
    ['Macintosh Version/18 Safari/605', 'MacIntel', 0, 'Safari', 'macOS'],
    ['Linux Firefox/132', 'Linux', 0, 'Firefox', 'Linux'],
    ['CrOS Chrome/131', 'Linux', 0, 'Chrome', 'ChromeOS'],
    ['', '', 0, 'Browser', 'Unknown device'],
  ])('recognizes coarse hints from %s', (userAgent, platform, maxTouchPoints, browser, devicePlatform) => {
    expect(pushDeviceInfo({ userAgent, platform, maxTouchPoints })).toEqual({ browser, platform: devicePlatform });
  });
  it('accepts only known hints without arbitrary metadata', () => {
    expect(isPushDeviceInfo({ browser: 'Chrome', platform: 'macOS' })).toBe(true);
    for (const value of [null, {}, { browser: 'Secret device name', platform: 'macOS' },
      { browser: 'Chrome', platform: 'macOS', userAgent: 'raw' }]) expect(isPushDeviceInfo(value)).toBe(false);
  });
});
