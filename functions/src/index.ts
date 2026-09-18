'use strict';

import { initializeFirebase } from './bootstrap';
import { loadOptimizedFunctionTarget } from './function-target-loader';

initializeFirebase();

const functionTarget = process.env.FUNCTION_TARGET?.trim();
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
