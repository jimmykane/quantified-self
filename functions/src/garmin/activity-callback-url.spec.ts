import { describe, expect, it } from 'vitest';
import { normalizeGarminActivityCallbackURL } from './activity-callback-url';

const URL = 'https://apis.garmin.com/wellness-api/rest/activityFile?id=9007199254740993123&token=a%2Bb%2Fc%3D';

describe('Garmin activity callback URL', () => {
  it('preserves opaque IDs, encoded pull tokens and the original query order', () => {
    expect(normalizeGarminActivityCallbackURL(URL)).toBe(URL);
  });
  it('permits legacy callbacks without a pull token', () => {
    const value = 'https://apis.garmin.com/wellness-api/rest/activityFile?id=123';
    expect(normalizeGarminActivityCallbackURL(value)).toBe(value);
  });
  it('permits an explicit standard HTTPS port', () => {
    const value = URL.replace('apis.garmin.com', 'apis.garmin.com:443');
    expect(normalizeGarminActivityCallbackURL(value)).toBe(value);
  });
  it.each([
    null, undefined, {}, '',
    URL.replace('https:', 'http:'), URL.replace('apis.garmin.com', 'evil.example'),
    URL.replace('apis.garmin.com', 'apis.garmin.com.evil.example'),
    URL.replace('apis.garmin.com', 'apis.garmin.com@evil.example'),
    URL.replace('apis.garmin.com', 'user@apis.garmin.com'),
    URL.replace('apis.garmin.com', '127.0.0.1'), URL.replace('apis.garmin.com', '[::1]'),
    URL.replace('apis.garmin.com', 'apis.garmin.com:8443'),
    URL.replace('activityFile', 'user/id'), URL.replace('activityFile', '%61ctivityFile'),
    URL + '#fragment', URL + '&id=second', URL + '&token=second',
    URL.replace('id=9007199254740993123', 'id='), URL.replace('token=a%2Bb%2Fc%3D', 'token='),
    ' https://apis.garmin.com/wellness-api/rest/activityFile?id=1',
    URL + '\n', URL + '\t', URL + '\u0000', URL + '\u007f', URL + '&extra=' + 'x'.repeat(8192),
  ])('rejects an unsupported or ambiguous destination %#', value => {
    expect(normalizeGarminActivityCallbackURL(value)).toBeNull();
  });
});
