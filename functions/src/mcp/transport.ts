import {
  createMcpHandler,
  isLegacyRequest,
  McpHandlerRequestOptions,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';

/** One authenticated request factory, identical tools and validation in both eras. */
export function createMcpTransportHandler(
  factory: () => McpServer,
  onerror: (error: Error) => void,
) {
  const modern = createMcpHandler(() => {
    const server = factory();
    // Modern clients must not discover a subscription capability we cannot
    // provide from an ephemeral, request-scoped Firebase Function handler.
    server.server.registerCapabilities({ tools: { listChanged: false } });
    return server;
  }, {
    legacy: 'reject',
    onerror,
    // This endpoint is request/response-only, never a long-lived subscription.
    maxSubscriptions: 0,
  });
  return {
    close: modern.close,
    async fetch(request: globalThis.Request, options?: McpHandlerRequestOptions): Promise<Response> {
      // Use the SDK classifier: a malformed modern envelope or header mismatch
      // must fail on the modern path, never silently fall back to legacy.
      if (!await isLegacyRequest(request, options?.parsedBody)) {
        return modern.fetch(request, options);
      }
      const server = factory();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      transport.onerror = onerror;
      try {
        await server.connect(transport);
        return await transport.handleRequest(request, options);
      } finally {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }
    },
  };
}
