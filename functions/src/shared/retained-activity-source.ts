interface RetainedSource { path: string; bucket?: string; generation?: string }

export function retainedSourceReferences(event: Record<string, any>): RetainedSource[] {
  const files = Array.isArray(event.originalFiles) && event.originalFiles.length ? event.originalFiles
    : event.originalFile ? [event.originalFile] : [];
  return files.map((source: RetainedSource) => ({ path: source?.path, ...(source?.bucket ? { bucket: source.bucket } : {}),
    ...(source?.generation ? { generation: source.generation } : {}) }));
}

export function retainedSourceRevision(event: Record<string, any>): string {
  return JSON.stringify(retainedSourceReferences(event));
}
