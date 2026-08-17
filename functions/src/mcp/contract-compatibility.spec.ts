import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  captureMcpContract,
  compareMcpContracts,
  createEmptyMcpContractHistory,
  createRegisteredMcpContract,
  digestMcpContract,
  evaluateMcpContractBaselineTransition,
  evaluateMcpContractGate,
  isCompletedMcpContractPromotion,
  JsonObject,
  JsonValue,
  McpContractChangeRecord,
  McpContractHistory,
  McpContractSnapshot,
  parseMcpContractChangeRecord,
  parseMcpContractHistory,
  parseRegisteredMcpContract,
  prepareMcpContractPromotionHistory,
  RegisteredMcpContract,
  stableMcpContractJson,
} from './contract-compatibility';
import { PUBLIC_MCP_TOOL_NAMES } from './tool-output-schemas';

const REGISTERED_CONTRACT_PATH = path.resolve(
  __dirname,
  'contracts/registered-contract.json',
);
const PENDING_CHANGE_PATH = path.resolve(
  __dirname,
  'contracts/pending-change.json',
);
const CONTRACT_CAPTURE_TIMEOUT_MS = 20_000;

let registered: RegisteredMcpContract;
let pending: McpContractChangeRecord | null;

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

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

function historyForTransition(
  previous: RegisteredMcpContract,
  candidate: RegisteredMcpContract,
  pending: McpContractChangeRecord,
): McpContractHistory {
  return parseMcpContractHistory({
    registryVersion: 1,
    transitions: [{
      formatVersion: 1,
      previousContractSha256: previous.contractSha256,
      previousLifecycle: previous.lifecycle,
      candidateSha256: candidate.contractSha256,
      candidateLifecycle: candidate.lifecycle,
      lifecycleAction: pending.lifecycleAction,
      summary: pending.summary,
      rescanRequired: true,
    }],
  });
}

beforeAll(async () => {
  registered = parseRegisteredMcpContract(JSON.parse(
    await readFile(REGISTERED_CONTRACT_PATH, 'utf8'),
  ) as unknown);
  const pendingText = await readOptionalFile(PENDING_CHANGE_PATH);
  pending = pendingText
    ? parseMcpContractChangeRecord(JSON.parse(pendingText) as unknown)
    : null;
});

describe('MCP registered-contract compatibility', () => {
  it(
    'matches the settled baseline or its exact pending contract across every scope profile',
    async () => {
      const candidate = await captureMcpContract(
        registered.contract.origin,
      );
      const evaluation = evaluateMcpContractGate(
        registered,
        candidate,
        pending,
      );

      expect(evaluation.errors).toEqual([]);
      expect(evaluation.comparison.breaking).toEqual([]);
      if (pending) {
        expect(evaluation.pendingActionRequired).toBe(true);
        expect(evaluation.candidateSha256).toBe(pending.candidateSha256);
      } else {
        expect(evaluation.pendingActionRequired).toBe(false);
        expect(evaluation.candidateSha256).toBe(registered.contractSha256);
        expect(evaluation.comparison.releaseRequired).toEqual([]);
      }
      expect(
        Object.keys(candidate.profiles['all-scopes'].tools).sort(),
      ).toEqual([...PUBLIC_MCP_TOOL_NAMES].sort());
    },
    CONTRACT_CAPTURE_TIMEOUT_MS,
  );

  it('normalizes semantically unordered schema arrays and object keys', () => {
    const left = {
      inputSchema: {
        required: ['beta', 'alpha'],
        properties: {
          beta: { type: 'number' },
          alpha: { type: 'string' },
        },
      },
    };
    const right = {
      inputSchema: {
        properties: {
          alpha: { type: 'string' },
          beta: { type: 'number' },
        },
        required: ['alpha', 'beta'],
      },
    };

    expect(stableMcpContractJson(left)).toBe(
      stableMcpContractJson(right),
    );
    expect(stableMcpContractJson({
      inputSchema: {
        enum: ['ä', 'z'],
      },
    })).toContain('"enum":["ä","z"]');
    const equivalentUnicode = JSON.parse(stableMcpContractJson({
      inputSchema: {
        enum: ['ä', 'a\u0308'],
      },
    })) as {
      inputSchema: {
        enum: string[];
      };
    };
    expect(equivalentUnicode.inputSchema.enum).toEqual([
      'a\u0308',
      'ä',
    ]);
    expect(stableMcpContractJson({
      profiles: {
        test: {
          scopes: ['sleep:read', 'metrics:read'],
        },
      },
    })).toBe(stableMcpContractJson({
      profiles: {
        test: {
          scopes: ['metrics:read', 'sleep:read'],
        },
      },
    }));
    expect(stableMcpContractJson({
      example: {
        scopes: ['first', 'second'],
        required: ['first', 'second'],
      },
    })).not.toBe(stableMcpContractJson({
      example: {
        scopes: ['second', 'first'],
        required: ['second', 'first'],
      },
    }));
    expect(stableMcpContractJson({
      metadata: {
        inputSchema: {
          required: ['first', 'second'],
        },
      },
    })).not.toBe(stableMcpContractJson({
      metadata: {
        inputSchema: {
          required: ['second', 'first'],
        },
      },
    }));
    expect(stableMcpContractJson({
      inputSchema: {
        default: {
          inputSchema: {
            required: ['first', 'second'],
          },
        },
      },
    })).not.toBe(stableMcpContractJson({
      inputSchema: {
        default: {
          inputSchema: {
            required: ['second', 'first'],
          },
        },
      },
    }));
    expect(stableMcpContractJson({
      inputSchema: {
        required: ['alpha', 'alpha', 'beta'],
      },
    })).not.toBe(stableMcpContractJson({
      inputSchema: {
        required: ['alpha', 'beta'],
      },
    }));
    expect(stableMcpContractJson({
      inputSchema: {
        properties: {
          default: {
            required: ['beta', 'alpha'],
          },
        },
      },
    })).toBe(stableMcpContractJson({
      inputSchema: {
        properties: {
          default: {
            required: ['alpha', 'beta'],
          },
        },
      },
    }));
  });

  it('rejects tool removals and scope-profile regressions', () => {
    const candidate = cloneRegisteredContract();
    candidate.profiles['leaky-profile'] = {
      ...structuredClone(candidate.profiles.metrics),
      scopes: [],
    };
    delete candidate.profiles.metrics.tools.list_metrics;
    candidate.profiles.metrics.scopes.push('sleep:read');
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
      expect.objectContaining({
        path: 'profiles.metrics.scopes',
      }),
      expect.objectContaining({
        path: 'profiles.leaky-profile.tools.query_metric',
      }),
    ]));
  });

  it('rejects changed existing-tool variants in new profiles', () => {
    const candidate = cloneRegisteredContract();
    candidate.profiles['metrics-combination'] = {
      ...structuredClone(candidate.profiles.metrics),
      scopes: ['future:read', 'metrics:read', 'metrics:read'],
    };
    replaceToolVariant(
      candidate,
      'metrics-combination',
      'query_metric',
      (tool) => {
        const schema = tool.outputSchema as JsonObject;
        schema.description = 'Changed only in the new profile.';
      },
    );

    const comparison = compareMcpContracts(
      registered.contract,
      candidate,
    );

    expect(comparison.breaking).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'profiles.metrics-combination.tools.query_metric',
      }),
      expect.objectContaining({
        path: 'profiles.metrics-combination.scopes',
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
    delete before.authorizationServer
      .revocation_endpoint_auth_methods_supported;
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
    candidate.authorizationServer.token_endpoint_auth_signing_alg_values_supported = [
      'RS256',
    ];
    candidate.server.capabilities.resources = {
      listChanged: true,
    };
    candidate.profiles['future-scope'] = {
      ...structuredClone(candidate.profiles.metrics),
      scopes: ['future:read', 'metrics:read'],
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
        path: 'authorizationServer.token_endpoint_auth_signing_alg_values_supported',
      }),
      expect.objectContaining({
        path: 'authorizationServer.revocation_endpoint_auth_methods_supported',
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

  it('allows additive scopes only on aggregate coverage profiles', () => {
    const candidate = cloneRegisteredContract();
    candidate.profiles['all-parent-scopes'].scopes.push('future:read');
    candidate.profiles['all-scopes'].scopes.push('future:read');

    const comparison = compareMcpContracts(
      registered.contract,
      candidate,
    );

    expect(comparison.breaking).toEqual([]);
    expect(comparison.releaseRequired).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'profiles.all-parent-scopes.scopes',
      }),
      expect.objectContaining({
        path: 'profiles.all-scopes.scopes',
      }),
    ]));
  });

  it('rejects duplicate metadata values even beside a compatible change', () => {
    const before = cloneRegisteredContract();
    delete before.authorizationServer
      .revocation_endpoint_auth_methods_supported;
    const candidate = cloneRegisteredContract();
    const scopes = candidate.authorizationServer
      .scopes_supported as JsonValue[];
    candidate.authorizationServer.scopes_supported = [
      ...scopes,
      scopes[0],
    ];
    candidate.authorizationServer
      .revocation_endpoint_auth_methods_supported = ['none', 'none'];
    candidate.server.identity.title = 'Quantified Self Data';

    const comparison = compareMcpContracts(
      before,
      candidate,
    );

    expect(comparison.breaking).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'authorizationServer.scopes_supported',
      }),
      expect.objectContaining({
        path: 'authorizationServer.revocation_endpoint_auth_methods_supported',
      }),
    ]));
    expect(comparison.releaseRequired).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'server.identity.title',
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

  it('supports publishing unchanged developer metadata explicitly', () => {
    const pending = matchingPending(registered.contract);
    pending.lifecycleAction = 'published-version';
    const promoted = createRegisteredMcpContract(
      registered.contract,
      'published',
    );
    const history = historyForTransition(
      registered,
      promoted,
      pending,
    );

    const evaluation = evaluateMcpContractGate(
      registered,
      registered.contract,
      pending,
    );

    expect(evaluation.errors).toEqual([]);
    expect(evaluation.pendingActionRequired).toBe(true);
    expect(evaluation.comparison).toEqual({
      breaking: [],
      releaseRequired: [],
    });
    expect(evaluateMcpContractBaselineTransition(
      registered,
      promoted,
      createEmptyMcpContractHistory(),
      history,
    ).errors).toEqual([]);
  });

  it('requires append-only history for compatible baseline transitions', () => {
    const candidate = cloneRegisteredContract();
    candidate.server.identity.title = 'Quantified Self Data';
    const promoted = createRegisteredMcpContract(candidate, 'developer');
    const pending = matchingPending(candidate);
    const history = historyForTransition(registered, promoted, pending);

    expect(evaluateMcpContractBaselineTransition(
      registered,
      promoted,
      createEmptyMcpContractHistory(),
      history,
    ).errors).toEqual([]);
    expect(evaluateMcpContractBaselineTransition(
      registered,
      promoted,
      createEmptyMcpContractHistory(),
      createEmptyMcpContractHistory(),
    ).errors).toContain(
      'A changed MCP baseline requires an appended transition record.',
    );

    const rewritten = structuredClone(history);
    rewritten.transitions[0].summary = 'Rewritten transition history.';
    expect(evaluateMcpContractBaselineTransition(
      promoted,
      promoted,
      history,
      rewritten,
    ).errors).toContain(
      'MCP contract transition history entry 0 was rewritten.',
    );
    expect(evaluateMcpContractBaselineTransition(
      promoted,
      promoted,
      history,
      createEmptyMcpContractHistory(),
    ).errors).toContain(
      'The MCP contract transition history was truncated.',
    );
  });

  it('prepares promotion history idempotently across interrupted writes', () => {
    const candidate = cloneRegisteredContract();
    candidate.server.identity.title = 'Quantified Self Data';
    const promoted = createRegisteredMcpContract(candidate, 'developer');
    const pending = matchingPending(candidate);
    const firstPlan = prepareMcpContractPromotionHistory(
      registered,
      promoted,
      createEmptyMcpContractHistory(),
      pending,
    );

    expect(firstPlan.historyAlreadyRecorded).toBe(false);
    expect(firstPlan.nextHistory.transitions).toHaveLength(1);

    const retryPlan = prepareMcpContractPromotionHistory(
      registered,
      promoted,
      firstPlan.nextHistory,
      pending,
    );

    expect(retryPlan.historyAlreadyRecorded).toBe(true);
    expect(retryPlan.nextHistory).toEqual(firstPlan.nextHistory);
    expect(isCompletedMcpContractPromotion(
      promoted,
      retryPlan.nextHistory,
      pending,
      promoted.contractSha256,
      pending.lifecycleAction,
    )).toBe(true);
    expect(isCompletedMcpContractPromotion(
      promoted,
      retryPlan.nextHistory,
      pending,
      registered.contractSha256,
      pending.lifecycleAction,
    )).toBe(false);
  });

  it('rejects breaking or invalidly chained baseline history', () => {
    const candidate = cloneRegisteredContract();
    replaceToolVariant(
      candidate,
      'metrics',
      'query_metric',
      (tool) => {
        const schema = tool.outputSchema as JsonObject;
        schema.description = 'Breaking registered output.';
      },
    );
    const promoted = createRegisteredMcpContract(candidate, 'developer');
    const pending = matchingPending(candidate);
    const history = historyForTransition(registered, promoted, pending);

    expect(evaluateMcpContractBaselineTransition(
      registered,
      promoted,
      createEmptyMcpContractHistory(),
      history,
    ).errors).toContain(
      'The registered MCP baseline contains a breaking transition.',
    );
    expect(() => parseMcpContractHistory({
      registryVersion: 1,
      transitions: [
        ...history.transitions,
        {
          ...history.transitions[0],
          previousContractSha256: registered.contractSha256,
        },
      ],
    })).toThrow(/does not continue the history chain/);
  });

  it('pins registered baselines to the production MCP origin', () => {
    const candidate = cloneRegisteredContract();
    candidate.origin = 'https://example.com';

    expect(() => createRegisteredMcpContract(
      candidate,
      'developer',
    )).toThrow(/origin must be https:\/\/quantified-self\.io/);
  });
});
