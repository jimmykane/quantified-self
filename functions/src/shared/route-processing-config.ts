export const MAX_ROUTE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_ROUTE_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
export const MAX_ROUTE_DECOMPRESSED_BYTES_LABEL = '512MB';

export const ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS = {
  memory: '4GiB',
  cpu: 2,
  concurrency: 1,
  maxInstances: 20,
  timeoutSeconds: 3600,
} as const;

export const ROUTE_PROCESSING_TASK_RUNTIME_OPTIONS = {
  memory: '4GiB',
  cpu: 2,
  concurrency: 1,
  timeoutSeconds: 1800,
} as const;
