import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  captureMcpContract,
  compareMcpContracts,
  digestMcpContract,
  evaluateMcpContractGate,
  JsonObject,
  JsonValue,
  McpContractChangeRecord,
  McpContractSnapshot,
  parseMcpContractChangeRecord,
  parseRegisteredMcpContract,
  RegisteredMcpContract,
  stableMcpContractJson,
} from './contract-compatibility';
import { PUBLIC_MCP_TOOL_NAMES } from './tool-output-schemas';

const REGISTERED_CONTRACT_PATH = path.resolve(
  __dirname,
  'contracts/registered-contract.json',
);

let registered: RegisteredMcpContract;

function variantDigest(value: unknown): string {
  return createHash('sha256')
    .update(stableMcpContractJson(value), 'utf8')
    .digest('hex');
}

function cloneRegisteredContract(): McpContractSnapshot {
  return structuredClone(registered.contract);
}

function replaceToolVariant(
  contract: McpContractSnapshot,
  profileId: string,
  toolName: string,
  mutate: (tool: JsonObject) => void,
): void {
  const profile = contract.profiles[profileId];
  const previousDigest = profile.tools[toolName];
  const previous = contract.toolVariants[previousDigest];
  const replacement = structuredClone(previous);
  mutate(replacement);
  const replacementDigest = variantDigest(replacement);
  contract.toolVariants[replacementDigest] = replacement;
  profile.tools[toolName] = replacementDigest;

  const previousStillUsed = Object.values(contract.profiles).some(candidate => (
    Object.values(candidate.tools).includes(previousDigest)
  ));
  if (!previousStillUsed) {
    delete contract.toolVariants[previousDigest];
  }
}

function matchingPending(
  candidate: McpContractSnapshot,
): McpContractChangeRecord {
  return {
    formatVersion: 1,
    candidateSha256: digestMcpContract(candidate),
    lifecycleAction: 'developer-refresh',
    summary: 'Exercise the contract metadata release gate.',
    rescanRequired: true,
  };
}

beforeAll(async () => {
  registered = parseRegisteredMcpContract(JSON.parse(
    await readFile(REGISTERED_CONTRACT_PATH, 'utf8'),
  ) as unknown);
});

describe('MCP registered-contract compatibility', () => {
  it('matches the settled in-memory server across every scope profile', async () => {
    const candidate = await captureMcpContract(
      registered.contract.origin,
    );

    expect(digestMcpContract(candidate)).toBe(registered.contractSha256);
    expect(compareMcpContracts(registered.contract, candidate)).toEqual({
      breaking: [],
      releaseRequired: [],
    });
    expect(
      Object.keys(candidate.profiles['all-scopes'].tools).sort(),
    ).toEqual([...PUBLIC_MCP_TOOL_NAMES].sort());
  });

  it('normalizes semantically unordered schema arrays and object keys', () => {
    const left = {
      required: ['beta', 'alpha', 'alpha'],
      properties: {
        beta: { type: 'number' },
        alpha: { type: 'string' },
      },
    };
    const right = {
      properties: {
        alpha: { type: 'string' },
        beta: { type: 'number' },
      },
      required: ['alpha', 'beta'],
    };

    expect(stableMcpContractJson(left)).toBe(
      stableMcpContractJson(right),
    );
  });

  it('rejects tool removals and scope-profile regressions', () => {
    const candidate = cloneRegisteredContract();
    delete candidate.profiles.metrics.tools.list_metrics;
    candidate.profiles.metrics.tools.list_sleep_sessions =
      candidate.profiles.sleep.tools.list_sleep_sessions;

    const comparison = compareMcpContracts(
      registered.contract,
      candidate,
    );

    expect(comparison.breaking).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'profiles.metrics.tools.list_metrics',
      }),
      expect.objectContaining({
        path: 'profiles.metrics.tools.list_sleep_sessions',
      }),
    ]));
  });

  it.each([
    'inputSchema',
    'outputSchema',
  ] as const)('freezes an existing tool %s', (schemaKey) => {
    const candidate = cloneRegisteredContract();
    replaceToolVariant(
      candidate,
      'metrics',
      'query_metric',
      (tool) => {
        const schema = tool[schemaKey] as JsonObject;
        schema.description = 'An incompatible schema mutation.';
      },
    );

    const comparison = compareMcpContracts(
      registered.contract,
      candidate,
    );

    expect(comparison.breaking).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: `profiles.metrics.tools.query_metric.${schemaKey}`,
      }),
    ]));
  });

  it('rejects behavior annotations, security schemes, and unknown tool fields', () => {
    const candidate = cloneRegisteredContract();
    replaceToolVariant(
      candidate,
      'metrics',
      'query_metric',
      (tool) => {
        const annotations = tool.annotations as JsonObject;
        annotations.readOnlyHint = false;
        tool._meta = {
          securitySchemes: [{
            type: 'oauth2',
          }],
          'openai/toolInvocation/invoking': 'Reading metrics…',
          'openai/widgetAccessible': true,
        };
        tool.securitySchemes = [{
          type: 'oauth2',
        }] as JsonValue;
        tool.unrecognizedContractField = true;
      },
    );

    const comparison = compareMcpContracts(
      registered.contract,
      candidate,
    );

    expect(comparison.breaking).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'profiles.metrics.tools.query_metric.annotations',
      }),
      expect.objectContaining({
        path: 'profiles.metrics.tools.query_metric.securitySchemes',
      }),
      expect.objectContaining({
        path: 'profiles.metrics.tools.query_metric._meta.securitySchemes',
      }),
      expect.objectContaining({
        path: 'profiles.metrics.tools.query_metric._meta.openai/widgetAccessible',
      }),
      expect.objectContaining({
        path: 'profiles.metrics.tools.query_metric.unrecognizedContractField',
      }),
    ]));
    expect(comparison.releaseRequired).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'profiles.metrics.tools.query_metric._meta.openai/toolInvocation/invoking',
      }),
    ]));
  });

  it('rejects MCP origin changes and OAuth capability removals', () => {
    const candidate = cloneRegisteredContract();
    candidate.origin = 'https://mcp.quantified-self.io';
    candidate.server.protocolVersion = '2099-01-01';
    candidate.authorizationServer.authorization_endpoint =
      'https://quantified-self.io/oauth/v2/authorize';
    const scopes = candidate.authorizationServer
      .scopes_supported as JsonValue[];
    candidate.authorizationServer.scopes_supported = scopes.filter(
      scope => scope !== 'metrics:read',
    );

    const comparison = compareMcpContracts(
      registered.contract,
      candidate,
    );

    expect(comparison.breaking).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'origin' }),
      expect.objectContaining({ path: 'server.protocolVersion' }),
      expect.objectContaining({
        path: 'authorizationServer.authorization_endpoint',
      }),
      expect.objectContaining({
        path: 'authorizationServer.scopes_supported',
      }),
    ]));
  });

  it('classifies additive OAuth, capability, and profile metadata as release-required', () => {
    const before = cloneRegisteredContract();
    const previousToolCapabilities =
      before.server.capabilities.tools as JsonObject;
    previousToolCapabilities.listChanged = false;
    const candidate = cloneRegisteredContract();
    candidate.authorizationServer.scopes_supported = [
      ...(candidate.authorizationServer.scopes_supported as JsonValue[]),
      'future:read',
    ];
    candidate.protectedResource.scopes_supported = [
      ...(candidate.protectedResource.scopes_supported as JsonValue[]),
      'future:read',
    ];
    candidate.authorizationServer.token_endpoint_auth_methods_supported = [
      ...(
        candidate.authorizationServer
          .token_endpoint_auth_methods_supported as JsonValue[]
      ),
      'private_key_jwt',
    ];
    candidate.server.capabilities.resources = {
      listChanged: true,
    };
    candidate.profiles['future-scope'] = {
      ...structuredClone(candidate.profiles.metrics),
      scopes: ['future:read'],
    };

    const comparison = compareMcpContracts(
      before,
      candidate,
    );

    expect(comparison.breaking).toEqual([]);
    expect(comparison.releaseRequired).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'authorizationServer.scopes_supported',
      }),
      expect.objectContaining({
        path: 'protectedResource.scopes_supported',
      }),
      expect.objectContaining({
        path: 'authorizationServer.token_endpoint_auth_methods_supported',
      }),
      expect.objectContaining({
        path: 'server.capabilities.resources',
      }),
      expect.objectContaining({
        path: 'server.capabilities.tools.listChanged',
      }),
      expect.objectContaining({
        path: 'profiles.future-scope',
      }),
    ]));
  });

  it('requires a digest-bound change record for additive tools and metadata', () => {
    const candidate = cloneRegisteredContract();
    replaceToolVariant(
      candidate,
      'metrics',
      'query_metric',
      (tool) => {
        tool.title = 'Query one metric safely';
      },
    );
    const additiveTool: JsonObject = {
      name: 'new_additive_tool',
      title: 'New additive tool',
      description: 'An additive read-only contract.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
    const digest = variantDigest(additiveTool);
    candidate.toolVariants[digest] = additiveTool;
    candidate.profiles.metrics.tools.new_additive_tool = digest;

    const withoutRecord = evaluateMcpContractGate(
      registered,
      candidate,
      null,
    );
    expect(withoutRecord.comparison.breaking).toEqual([]);
    expect(withoutRecord.comparison.releaseRequired.length).toBeGreaterThan(0);
    expect(withoutRecord.errors).toContain(
      'Metadata changes require a pending MCP contract change record.',
    );

    const withRecord = evaluateMcpContractGate(
      registered,
      candidate,
      matchingPending(candidate),
    );
    expect(withRecord.errors).toEqual([]);
  });

  it('rejects stale and mismatched pending change records', () => {
    const stale = evaluateMcpContractGate(
      registered,
      registered.contract,
      matchingPending(registered.contract),
    );
    expect(stale.errors).toContain(
      'The pending MCP contract change record is stale because no metadata refresh is required.',
    );

    const candidate = cloneRegisteredContract();
    candidate.server.identity.title = 'Quantified Self Data';
    const mismatched = matchingPending(candidate);
    mismatched.candidateSha256 = registered.contractSha256;
    const evaluation = evaluateMcpContractGate(
      registered,
      candidate,
      mismatched,
    );
    expect(evaluation.errors).toContain(
      'The pending MCP contract change digest does not match the candidate.',
    );
  });

  it('rejects malformed or forward-extended change records', () => {
    const valid = matchingPending(registered.contract);

    expect(() => parseMcpContractChangeRecord({
      ...valid,
      rescanRequired: false,
    })).toThrow();
    expect(() => parseMcpContractChangeRecord({
      ...valid,
      futureAction: 'skip-rescan',
    })).toThrow();
  });

  it('requires published baselines to use the published-version action', () => {
    const candidate = cloneRegisteredContract();
    candidate.server.identity.title = 'Quantified Self Data';
    const published: RegisteredMcpContract = {
      ...registered,
      lifecycle: 'published',
    };
    const evaluation = evaluateMcpContractGate(
      published,
      candidate,
      matchingPending(candidate),
    );

    expect(evaluation.errors).toContain(
      'Lifecycle action developer-refresh is invalid for published metadata.',
    );
  });
});
