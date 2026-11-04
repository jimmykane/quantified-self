import type { PushDeviceInfo } from '@shared/web-push';

/** Coarse display hints only: never persist the user agent or fingerprint a device. */
export function pushDeviceInfo(navigator: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): PushDeviceInfo {
  const ua = navigator.userAgent || '';
  const browser = /Edg\/|EdgA\/|EdgiOS\//.test(ua) ? 'Edge'
    : /OPR\/|OPiOS\//.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const platform = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  return { browser, platform };
}
