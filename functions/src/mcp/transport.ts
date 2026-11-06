import {
  createMcpHandler,
  isLegacyRequest,
  McpHandlerRequestOptions,
  McpServer,
  ProtocolErrorCode,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';

const BAD_REQUEST_REASONS = new Map<number, string>([
  [ProtocolErrorCode.ParseError, 'invalid_json'],
  [ProtocolErrorCode.InvalidRequest, 'invalid_json_rpc'],
  [ProtocolErrorCode.InvalidParams, 'invalid_params'],
  [ProtocolErrorCode.MissingRequiredClientCapability, 'missing_client_capability'],
  [ProtocolErrorCode.UnsupportedProtocolVersion, 'unsupported_protocol_version'],
]);

/** Inspect only the SDK's error code; never forward its message, data or echoed ID. */
export async function observeMcpBadRequest(
  response: Response,
  observe?: (diagnostic: { reason: string; rpcErrorCode: number | null }) => void,
): Promise<Response> {
  if (response.status !== 400 || !observe) return response;
  let rpcErrorCode: number | null = null;
  try {
    const body = await response.clone().json();
    if (typeof body?.error?.code === 'number' && BAD_REQUEST_REASONS.has(body.error.code)) {
      rpcErrorCode = body.error.code;
    }
  } catch { /* A non-JSON error response still needs a safe fallback diagnostic. */ }
  try {
    observe({ reason: rpcErrorCode === null ? 'unclassified_bad_request' : BAD_REQUEST_REASONS.get(rpcErrorCode)!, rpcErrorCode });
  } catch { /* Logging must not change the response or retry behavior. */ }
  return response;
}

/** One authenticated request factory, identical tools and validation in both eras. */
export function createMcpTransportHandler(
  factory: () => McpServer,
  onerror: (error: Error) => void,
  onbadrequest?: Parameters<typeof observeMcpBadRequest>[1],
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
        return observeMcpBadRequest(await modern.fetch(request, options), onbadrequest);
      }
      const server = factory();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      transport.onerror = onerror;
      try {
        await server.connect(transport);
        return await observeMcpBadRequest(await transport.handleRequest(request, options), onbadrequest);
      } finally {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }
    },
  };
}
