type FunctionModule = Record<string, unknown>;
type ModuleLoader = () => FunctionModule;

const loadMarketingHandlers = (): FunctionModule =>
  module.require('./admin/marketing/handlers') as FunctionModule;

const TARGET_LOADERS: Readonly<Record<string, ModuleLoader>> = Object.freeze({
  getSuuntoAPIAuthRequestTokenRedirectURI:
    () => module.require('./suunto/auth/wrapper') as FunctionModule,
  requestAndSetSuuntoAPIAccessToken:
    () => module.require('./suunto/auth/wrapper') as FunctionModule,
  listMarketingCampaigns: loadMarketingHandlers,
  saveMarketingCampaign: loadMarketingHandlers,
  cloneMarketingCampaign: loadMarketingHandlers,
  previewMarketingCampaign: loadMarketingHandlers,
  prepareMarketingCampaign: loadMarketingHandlers,
  setMarketingDailyCap: loadMarketingHandlers,
  sendMarketingTest: loadMarketingHandlers,
  changeMarketingCampaignStatus: loadMarketingHandlers,
  dispatchMarketingCampaigns: loadMarketingHandlers,
  trackMarketingDelivery: loadMarketingHandlers,
  marketingUnsubscribe: loadMarketingHandlers,
  projectEventTagCatalog:
    () => module.require('./events/event-tag-catalog.trigger') as FunctionModule,
});

export const OPTIMIZED_FUNCTION_TARGETS = Object.freeze(Object.keys(TARGET_LOADERS));

export function resolveRuntimeFunctionTarget(
  environment: Readonly<NodeJS.ProcessEnv>,
): string | undefined {
  // Firebase uses either of these modes while discovering the complete
  // deployment manifest. Ignore an inherited FUNCTION_TARGET so discovery can
  // never collapse the exported inventory to one optimized handler.
  if (
    environment.FUNCTIONS_CONTROL_API === 'true'
    || environment.FUNCTIONS_MANIFEST_OUTPUT_PATH
  ) {
    return undefined;
  }

  return environment.FUNCTION_TARGET?.trim() || undefined;
}

export function loadFunctionTarget(
  target: string,
  targetLoaders: Readonly<Record<string, ModuleLoader>>,
): unknown | undefined {
  const loader = Object.prototype.hasOwnProperty.call(targetLoaders, target)
    ? targetLoaders[target]
    : undefined;
  if (!loader) return undefined;

  const handler = loader()[target];
  if (!handler) {
    throw new Error(`Function target "${target}" was not exported by its configured module.`);
  }
  return handler;
}

export function loadOptimizedFunctionTarget(target: string): unknown | undefined {
  return loadFunctionTarget(target, TARGET_LOADERS);
}
