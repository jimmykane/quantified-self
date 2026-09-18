import { describe, expect, it, vi } from 'vitest';
import {
  loadFunctionTarget,
  OPTIMIZED_FUNCTION_TARGETS,
} from './function-target-loader';

describe('function target loader', () => {
  it('keeps the first canary limited to the two Suunto OAuth functions', () => {
    expect(OPTIMIZED_FUNCTION_TARGETS).toEqual([
      'getSuuntoAPIAuthRequestTokenRedirectURI',
      'requestAndSetSuuntoAPIAccessToken',
    ]);
  });

  it('returns the original exported function object', () => {
    const handler = { __trigger: { platform: 'gcfv2' } };
    const loader = vi.fn(() => ({ suuntoTarget: handler }));

    expect(loadFunctionTarget('suuntoTarget', { suuntoTarget: loader })).toBe(handler);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('does not load a module for an unknown target', () => {
    const loader = vi.fn(() => ({ suuntoTarget: {} }));

    expect(loadFunctionTarget('otherTarget', { suuntoTarget: loader })).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it('treats inherited object properties as unknown targets', () => {
    const loader = vi.fn(() => ({ suuntoTarget: {} }));

    expect(loadFunctionTarget('toString', { suuntoTarget: loader })).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it('fails when the configured module does not export its target', () => {
    expect(() => loadFunctionTarget('suuntoTarget', {
      suuntoTarget: () => ({}),
    })).toThrow('Function target "suuntoTarget" was not exported by its configured module.');
  });
});
