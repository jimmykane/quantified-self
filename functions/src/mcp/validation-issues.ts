import { z } from 'zod';

export interface McpValidationIssueSummary {
  code: string;
  path: Array<string | number>;
}

/**
 * Keep validation diagnostics useful without echoing rejected values, authored
 * content, document identifiers, or free-form schema messages into logs or MCP
 * error results.
 */
export function summarizeMcpValidationIssues(
  error: unknown,
): McpValidationIssueSummary[] | null {
  if (!(error instanceof z.ZodError)) {
    return null;
  }
  return error.issues.slice(0, 8).map(issue => ({
    code: issue.code,
    path: issue.path.slice(0, 8).map(part => {
      if (typeof part === 'number') {
        return part;
      }
      return typeof part === 'string'
        && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(part)
        ? part
        : '<dynamic>';
    }),
  }));
}
