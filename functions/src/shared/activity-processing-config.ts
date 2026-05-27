export const MAX_ACTIVITY_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_ACTIVITY_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
export const MAX_ACTIVITY_DECOMPRESSED_BYTES_LABEL = '512MB';

export const ACTIVITY_PROCESSING_RUNTIME_BASE_OPTIONS = {
  memory: '4GiB',
  cpu: 2,
  concurrency: 1,
} as const;

export const ACTIVITY_PROCESSING_HTTPS_RUNTIME_OPTIONS = {
  ...ACTIVITY_PROCESSING_RUNTIME_BASE_OPTIONS,
  maxInstances: 20,
  timeoutSeconds: 3600,
} as const;

export const REPARSE_PROCESSING_RUNTIME_BASE_OPTIONS = {
  memory: '1GiB',
  cpu: 2,
  concurrency: 1,
} as const;

export const REPARSE_PROCESSING_HTTPS_RUNTIME_OPTIONS = {
  ...REPARSE_PROCESSING_RUNTIME_BASE_OPTIONS,
  maxInstances: 20,
  timeoutSeconds: 3600,
} as const;

// Cloud Tasks functions cannot use the 3600s HTTPS/callable maximum; their
// documented maximum is 1800s.
export const ACTIVITY_PROCESSING_TASK_RUNTIME_OPTIONS = {
  ...ACTIVITY_PROCESSING_RUNTIME_BASE_OPTIONS,
  timeoutSeconds: 1800,
} as const;

export const REPARSE_PROCESSING_TASK_RUNTIME_OPTIONS = {
  ...REPARSE_PROCESSING_RUNTIME_BASE_OPTIONS,
  timeoutSeconds: 1800,
} as const;

export const REPARSE_PROCESSING_HEAVY_TASK_RUNTIME_OPTIONS = {
  memory: '8GiB',
  cpu: 2,
  concurrency: 1,
  maxInstances: 1,
  timeoutSeconds: 1800,
} as const;

export const REPARSE_PROCESSING_HEAVY_TASK_RATE_LIMITS = {
  maxConcurrentDispatches: 1,
  maxDispatchesPerSecond: 1,
} as const;
