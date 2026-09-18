type FunctionModule = Record<string, unknown>;
type ModuleLoader = () => FunctionModule;

const TARGET_LOADERS: Readonly<Record<string, ModuleLoader>> = Object.freeze({
  getSuuntoAPIAuthRequestTokenRedirectURI:
    () => module.require('./suunto/auth/wrapper') as FunctionModule,
  requestAndSetSuuntoAPIAccessToken:
    () => module.require('./suunto/auth/wrapper') as FunctionModule,
});

export const OPTIMIZED_FUNCTION_TARGETS = Object.freeze(Object.keys(TARGET_LOADERS));

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
