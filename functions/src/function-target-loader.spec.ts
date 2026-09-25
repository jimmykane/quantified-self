import { describe, expect, it, vi } from 'vitest';
import {
  loadFunctionTarget,
  OPTIMIZED_FUNCTION_TARGETS,
  resolveRuntimeFunctionTarget,
} from './function-target-loader';

describe('function target loader', () => {
  it('optimizes the Suunto OAuth, marketing, and event tag projection functions', () => {
    expect(OPTIMIZED_FUNCTION_TARGETS).toEqual([
      'getSuuntoAPIAuthRequestTokenRedirectURI',
      'requestAndSetSuuntoAPIAccessToken',
      'listMarketingCampaigns',
      'saveMarketingCampaign',
      'cloneMarketingCampaign',
      'previewMarketingCampaign',
      'prepareMarketingCampaign',
      'setMarketingDailyCap',
      'sendMarketingTest',
      'changeMarketingCampaignStatus',
      'dispatchMarketingCampaigns',
      'trackMarketingDelivery',
      'marketingUnsubscribe',
      'projectEventTagCatalog',
    ]);
  });

  it('resolves a trimmed target only during runtime loading', () => {
    expect(resolveRuntimeFunctionTarget({ FUNCTION_TARGET: '  suuntoTarget  ' }))
      .toBe('suuntoTarget');
    expect(resolveRuntimeFunctionTarget({ FUNCTION_TARGET: '   ' })).toBeUndefined();
  });

  it.each([
    { FUNCTIONS_CONTROL_API: 'true' },
    { FUNCTIONS_MANIFEST_OUTPUT_PATH: '/tmp/functions.yaml' },
  ])('ignores an inherited target during Firebase discovery: %o', discoveryEnvironment => {
    expect(resolveRuntimeFunctionTarget({
      FUNCTION_TARGET: 'getSuuntoAPIAuthRequestTokenRedirectURI',
      ...discoveryEnvironment,
    })).toBeUndefined();
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
