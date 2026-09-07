import {
  McpServer,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { PublicMcpToolName } from './tool-output-schemas';

// Keep the registered draft-07 advertisement while retaining the exact Zod
// validator (including refinements). SDK upgrades must not rewrite tool schemas.
function registeredSchema<T extends z.ZodType>(
  schema: T,
): StandardSchemaWithJSON<z.input<T>, z.output<T>> {
  return {
    '~standard': {
      ...schema['~standard'],
      jsonSchema: {
        input: () => z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }),
        output: () => z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }),
      },
    },
  };
}

export function registerMcpTool<Input extends z.ZodType>(
  server: McpServer,
  name: PublicMcpToolName,
  config: {
    title: string;
    description: string;
    inputSchema: Input;
    outputSchema: z.ZodType;
    annotations: ToolAnnotations;
  },
  callback: ToolCallback<StandardSchemaWithJSON<z.input<Input>, z.output<Input>>>,
): void {
  const tool = server.registerTool(name, {
    ...config,
    inputSchema: registeredSchema(config.inputSchema),
    outputSchema: registeredSchema(config.outputSchema),
  }, callback);
  // This public registration field preserves the frozen 2025-era contract.
  // The SDK's 2026 wire codec removes execution, as required by that revision.
  tool.execution = { taskSupport: 'forbidden' };
}
