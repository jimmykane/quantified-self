import { describe, expect, it } from 'vitest';
import { parseCaptureProtocolVersion } from './mcp-contract';

describe('MCP contract capture protocol selection', () => {
  it('defaults to the registered legacy protocol only when the flag is absent', () => {
    expect(parseCaptureProtocolVersion(['capture', '--output', '/tmp/contract.json']))
      .toBe('2025-11-25');
  });

  it.each(['2025-11-25', '2026-07-28'])('accepts an explicit %s capture', protocol => {
    expect(parseCaptureProtocolVersion(['capture', '--protocol-version', protocol]))
      .toBe(protocol);
  });

  it.each([
    ['--protocol-version'],
    ['--protocol-version', '--output', '/tmp/contract.json'],
    ['--protocol-version', ''],
    ['--protocol-version', '2099-01-01'],
  ])('rejects missing or unsupported versions: %j', (...args) => {
    expect(() => parseCaptureProtocolVersion(args)).toThrow(
      'capture --protocol-version must be 2025-11-25 or 2026-07-28.',
    );
  });
});
