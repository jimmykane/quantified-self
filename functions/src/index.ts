'use strict';

import { initializeFirebase } from './bootstrap';
import {
  loadOptimizedFunctionTarget,
  resolveRuntimeFunctionTarget,
} from './function-target-loader';

initializeFirebase();

const functionTarget = resolveRuntimeFunctionTarget(process.env);
const optimizedHandler = functionTarget
  ? loadOptimizedFunctionTarget(functionTarget)
  : undefined;

if (functionTarget && optimizedHandler) {
  // Preserve the original Firebase function object and its trigger metadata.
  module.exports[functionTarget] = optimizedHandler;
} else {
  // Firebase CLI discovery has no FUNCTION_TARGET. Unknown runtime targets use
  // the complete entrypoint until they are explicitly added to the optimized map.
  Object.assign(module.exports, module.require('./full-entrypoint'));
}

// Firebase manifests convert hyphens in endpoint IDs to dotted runtime paths.
// Keep discovery's flat compatibility ID while making that runtime path resolvable.
const portalCompatibility = module.exports['ext-firestore-stripe-payments-createPortalLink'];
if (portalCompatibility) Object.defineProperty(module.exports, 'ext', {
  enumerable: false, value: { firestore: { stripe: { payments: { createPortalLink: portalCompatibility } } } },
});
