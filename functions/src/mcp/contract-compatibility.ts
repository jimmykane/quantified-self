import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  McpOAuthScope,
  MCP_OAUTH_SCOPES,
} from './oauth.service';
import {
  buildMcpAuthorizationServerMetadata,
  buildMcpProtectedResourceMetadata,
  createMcpServer,
} from './server';

export const MCP_CONTRACT_ORIGIN = 'https://quantified-self.io';
export const MCP_CONTRACT_FORMAT_VERSION = 1 as const;
export const MCP_CONTRACT_REGISTRY_VERSION = 1 as const;

const MCP_CONTRACT_PROFILE_DEFINITIONS: ReadonlyArray<{
  id: string;
  scopes: McpOAuthScope[];
}> = [{
  id: 'no-data-scopes',
  scopes: [],
}, {
  id: 'metrics',
  scopes: [MCP_OAUTH_SCOPES.MetricsRead],
}, {
  id: 'measurements',
  scopes: [MCP_OAUTH_SCOPES.MeasurementsRead],
}, {
  id: 'sleep',
  scopes: [MCP_OAUTH_SCOPES.SleepRead],
}, {
  id: 'activity-details',
  scopes: [MCP_OAUTH_SCOPES.ActivityDetailsRead],
}, {
  id: 'activity-location',
  scopes: [
    MCP_OAUTH_SCOPES.ActivityDetailsRead,
    MCP_OAUTH_SCOPES.ActivityLocationRead,
  ],
}, {
  id: 'routes',
  scopes: [MCP_OAUTH_SCOPES.RoutesRead],
}, {
  id: 'route-location',
  scopes: [
    MCP_OAUTH_SCOPES.RoutesRead,
    MCP_OAUTH_SCOPES.RouteLocationRead,
  ],
}, {
  id: 'activity-metrics',
  scopes: [
    MCP_OAUTH_SCOPES.MetricsRead,
    MCP_OAUTH_SCOPES.ActivityDetailsRead,
  ],
}, {
  id: 'all-parent-scopes',
  scopes: [
    MCP_OAUTH_SCOPES.MetricsRead,
    MCP_OAUTH_SCOPES.MeasurementsRead,
    MCP_OAUTH_SCOPES.SleepRead,
    MCP_OAUTH_SCOPES.ActivityDetailsRead,
    MCP_OAUTH_SCOPES.RoutesRead,
  ],
}, {
  id: 'all-scopes',
  scopes: Object.values(MCP_OAUTH_SCOPES),
}];

type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const sha256Schema = z.string().regex(SHA256_PATTERN);
const jsonObjectSchema = z.record(z.string(), z.json());
const contractProfileSchema = z.object({
  scopes: z.array(z.string()),
  instructions: z.string().nullable(),
  tools: z.record(z.string(), sha256Schema),
}).strict();

export const MCP_CONTRACT_SNAPSHOT_SCHEMA = z.object({
  formatVersion: z.literal(MCP_CONTRACT_FORMAT_VERSION),
  origin: z.url(),
  protectedResource: jsonObjectSchema,
  authorizationServer: jsonObjectSchema,
  server: z.object({
    protocolVersion: z.string().min(1),
    identity: jsonObjectSchema,
    capabilities: jsonObjectSchema,
  }).strict(),
  profiles: z.record(z.string(), contractProfileSchema),
  toolVariants: z.record(z.string(), jsonObjectSchema),
}).strict();

export type McpContractSnapshot = z.infer<
  typeof MCP_CONTRACT_SNAPSHOT_SCHEMA
>;

export const REGISTERED_MCP_CONTRACT_SCHEMA = z.object({
  registryVersion: z.literal(MCP_CONTRACT_REGISTRY_VERSION),
  lifecycle: z.enum(['developer', 'published']),
  contractSha256: sha256Schema,
  contract: MCP_CONTRACT_SNAPSHOT_SCHEMA,
}).strict();

export type RegisteredMcpContract = z.infer<
  typeof REGISTERED_MCP_CONTRACT_SCHEMA
>;

export const MCP_CONTRACT_CHANGE_RECORD_SCHEMA = z.object({
  formatVersion: z.literal(MCP_CONTRACT_FORMAT_VERSION),
  candidateSha256: sha256Schema,
  lifecycleAction: z.enum(['developer-refresh', 'published-version']),
  summary: z.string().trim().min(1).max(500),
  rescanRequired: z.literal(true),
}).strict();

export type McpContractChangeRecord = z.infer<
  typeof MCP_CONTRACT_CHANGE_RECORD_SCHEMA
>;

const UNORDERED_ARRAY_KEYS = new Set([
  'allOf',
  'anyOf',
  'authorization_servers',
  'bearer_methods_supported',
  'code_challenge_methods_supported',
  'enum',
  'grant_types_supported',
  'oneOf',
  'required',
  'response_types_supported',
  'revocation_endpoint_auth_methods_supported',
  'scopes',
  'scopes_supported',
  'token_endpoint_auth_methods_supported',
  'type',
]);

function toJsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('The MCP contract contains a non-JSON value.');
  }
  return JSON.parse(serialized) as JsonValue;
}

function normalizeJsonValue(
  value: JsonValue,
  parentKey?: string,
): JsonValue {
  if (Array.isArray(value)) {
    let normalized = value.map(child => normalizeJsonValue(child));
    if (parentKey && UNORDERED_ARRAY_KEYS.has(parentKey)) {
      normalized = [...new Map(
        normalized.map(child => [JSON.stringify(child), child]),
      ).values()];
      normalized.sort((left, right) => (
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      ));
    }
    return normalized;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, normalizeJsonValue(value[key], key)]),
    );
  }
  return value;
}

export function normalizeMcpContractJson(value: unknown): JsonValue {
  return normalizeJsonValue(toJsonValue(value));
}

function normalizedObject(value: unknown): JsonObject {
  const normalized = normalizeMcpContractJson(value);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('The MCP contract expected a JSON object.');
  }
  return normalized;
}

export function stableMcpContractJson(value: unknown): string {
  return JSON.stringify(normalizeMcpContractJson(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function jsonDigest(value: unknown): string {
  return sha256(stableMcpContractJson(value));
}

export function digestMcpContract(contract: McpContractSnapshot): string {
  return jsonDigest(contract);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return stableMcpContractJson(left) === stableMcpContractJson(right);
}

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

interface CapturedProfile {
  capabilities: JsonObject;
  identity: JsonObject;
  instructions: string | null;
  protocolVersion: string;
  tools: JsonObject[];
}

async function captureProfile(
  profileId: string,
  scopes: McpOAuthScope[],
  origin: string,
): Promise<CapturedProfile> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer({
    uid: 'mcp-contract-user',
    clientId: 'https://contract-client.example/client.json',
    connectionId: `mcp-contract-${profileId}`,
    scopes: [...scopes],
  }, origin);
  const client = new Client({
    name: 'quantified-self-contract-capture',
    version: '1.0.0',
  });
  let protocolVersion: string | null = null;
  const versionedClientTransport = Object.assign(clientTransport, {
    setProtocolVersion(value: string): void {
      protocolVersion = value;
    },
  });

  try {
    await server.connect(serverTransport);
    await client.connect(versionedClientTransport);
    const identity = client.getServerVersion();
    const capabilities = client.getServerCapabilities();
    if (!identity || !capabilities || !protocolVersion) {
      throw new Error(`MCP profile ${profileId} did not initialize.`);
    }

    const tools = new Map<string, JsonObject>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of result.tools) {
        if (tools.has(tool.name)) {
          throw new Error(
            `MCP profile ${profileId} advertised duplicate tool ${tool.name}.`,
          );
        }
        tools.set(tool.name, normalizedObject(tool));
      }
      const nextCursor = typeof result.nextCursor === 'string'
        ? result.nextCursor
        : undefined;
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(
          `MCP profile ${profileId} repeated a tools/list cursor.`,
        );
      }
      if (nextCursor) {
        seenCursors.add(nextCursor);
      }
      cursor = nextCursor;
    } while (cursor);

    return {
      identity: normalizedObject(identity),
      capabilities: normalizedObject(capabilities),
      instructions: client.getInstructions() || null,
      protocolVersion,
      tools: [...tools.values()].sort((left, right) => (
        `${left.name}`.localeCompare(`${right.name}`)
      )),
    };
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export async function captureMcpContract(
  origin = MCP_CONTRACT_ORIGIN,
): Promise<McpContractSnapshot> {
  const profiles: Record<string, {
    scopes: string[];
    instructions: string | null;
    tools: Record<string, string>;
  }> = {};
  const toolVariants: Record<string, JsonObject> = {};
  let serverIdentity: JsonObject | null = null;
  let serverCapabilities: JsonObject | null = null;
  let serverProtocolVersion: string | null = null;

  for (const definition of MCP_CONTRACT_PROFILE_DEFINITIONS) {
    if (profiles[definition.id]) {
      throw new Error(
        `MCP contract profile ${definition.id} is defined more than once.`,
      );
    }
    const captured = await captureProfile(
      definition.id,
      definition.scopes,
      origin,
    );
    if (serverIdentity && !jsonEqual(serverIdentity, captured.identity)) {
      throw new Error(
        `MCP server identity changed for profile ${definition.id}.`,
      );
    }
    if (
      serverCapabilities
      && !jsonEqual(serverCapabilities, captured.capabilities)
    ) {
      throw new Error(
        `MCP server capabilities changed for profile ${definition.id}.`,
      );
    }
    if (
      serverProtocolVersion
      && serverProtocolVersion !== captured.protocolVersion
    ) {
      throw new Error(
        `MCP protocol version changed for profile ${definition.id}.`,
      );
    }
    serverIdentity ||= captured.identity;
    serverCapabilities ||= captured.capabilities;
    serverProtocolVersion ||= captured.protocolVersion;

    const tools: Record<string, string> = {};
    for (const tool of captured.tools) {
      const name = typeof tool.name === 'string' ? tool.name : '';
      if (!name) {
        throw new Error(
          `MCP profile ${definition.id} advertised an unnamed tool.`,
        );
      }
      const variantDigest = jsonDigest(tool);
      const existing = toolVariants[variantDigest];
      if (existing && !jsonEqual(existing, tool)) {
        throw new Error('An MCP tool-variant digest collision occurred.');
      }
      toolVariants[variantDigest] = tool;
      tools[name] = variantDigest;
    }
    profiles[definition.id] = {
      scopes: [...definition.scopes].sort(),
      instructions: captured.instructions,
      tools,
    };
  }

  if (!serverIdentity || !serverCapabilities || !serverProtocolVersion) {
    throw new Error('No MCP contract profiles were captured.');
  }

  return normalizeAndValidateSnapshot({
    formatVersion: MCP_CONTRACT_FORMAT_VERSION,
    origin,
    protectedResource: buildMcpProtectedResourceMetadata(origin),
    authorizationServer: buildMcpAuthorizationServerMetadata(origin),
    server: {
      protocolVersion: serverProtocolVersion,
      identity: serverIdentity,
      capabilities: serverCapabilities,
    },
    profiles,
    toolVariants,
  });
}

function normalizeAndValidateSnapshot(value: unknown): McpContractSnapshot {
  const normalized = normalizeMcpContractJson(value);
  const contract = MCP_CONTRACT_SNAPSHOT_SCHEMA.parse(normalized);
  validateMcpContractIntegrity(contract);
  return contract;
}

export function createRegisteredMcpContract(
  contract: McpContractSnapshot,
  lifecycle: RegisteredMcpContract['lifecycle'],
): RegisteredMcpContract {
  const normalized = normalizeAndValidateSnapshot(contract);
  return {
    registryVersion: MCP_CONTRACT_REGISTRY_VERSION,
    lifecycle,
    contractSha256: digestMcpContract(normalized),
    contract: normalized,
  };
}

export function parseRegisteredMcpContract(
  value: unknown,
): RegisteredMcpContract {
  const parsed = REGISTERED_MCP_CONTRACT_SCHEMA.parse(
    normalizeMcpContractJson(value),
  );
  const normalized = createRegisteredMcpContract(
    parsed.contract,
    parsed.lifecycle,
  );
  if (normalized.contractSha256 !== parsed.contractSha256) {
    throw new Error(
      'The registered MCP contract digest does not match its contents.',
    );
  }
  return normalized;
}

export function parseMcpContractChangeRecord(
  value: unknown,
): McpContractChangeRecord {
  return MCP_CONTRACT_CHANGE_RECORD_SCHEMA.parse(
    normalizeMcpContractJson(value),
  );
}

function validateMcpContractIntegrity(contract: McpContractSnapshot): void {
  const referencedVariants = new Set<string>();
  for (const [digest, tool] of Object.entries(contract.toolVariants)) {
    if (jsonDigest(tool) !== digest) {
      throw new Error(`MCP tool variant ${digest} has an invalid digest.`);
    }
    if (typeof tool.name !== 'string' || !tool.name) {
      throw new Error(`MCP tool variant ${digest} has no valid name.`);
    }
  }
  for (const [profileId, profile] of Object.entries(contract.profiles)) {
    for (const [toolName, digest] of Object.entries(profile.tools)) {
      const tool = contract.toolVariants[digest];
      if (!tool) {
        throw new Error(
          `MCP profile ${profileId} references missing variant ${digest}.`,
        );
      }
      if (tool.name !== toolName) {
        throw new Error(
          `MCP profile ${profileId} maps ${toolName} to ${String(tool.name)}.`,
        );
      }
      referencedVariants.add(digest);
    }
  }
  for (const digest of Object.keys(contract.toolVariants)) {
    if (!referencedVariants.has(digest)) {
      throw new Error(`MCP tool variant ${digest} is not used by a profile.`);
    }
  }
}

export type McpContractFindingKind = 'breaking' | 'release-required';

export interface McpContractFinding {
  kind: McpContractFindingKind;
  path: string;
  message: string;
}

export interface McpContractComparison {
  breaking: McpContractFinding[];
  releaseRequired: McpContractFinding[];
}

class FindingCollector {
  private readonly findings = new Map<string, McpContractFinding>();

  add(
    kind: McpContractFindingKind,
    path: string,
    message: string,
  ): void {
    const key = `${kind}\u0000${path}\u0000${message}`;
    this.findings.set(key, { kind, path, message });
  }

  result(): McpContractComparison {
    const findings = [...this.findings.values()].sort((left, right) => (
      `${left.kind}:${left.path}:${left.message}`.localeCompare(
        `${right.kind}:${right.path}:${right.message}`,
      )
    ));
    return {
      breaking: findings.filter(finding => finding.kind === 'breaking'),
      releaseRequired: findings.filter(
        finding => finding.kind === 'release-required',
      ),
    };
  }
}

function compareExact(
  registered: unknown,
  candidate: unknown,
  path: string,
  collector: FindingCollector,
  message: string,
): void {
  if (!jsonEqual(registered, candidate)) {
    collector.add('breaking', path, message);
  }
}

function compareReleaseMetadata(
  registered: unknown,
  candidate: unknown,
  path: string,
  collector: FindingCollector,
  message: string,
): void {
  if (!jsonEqual(registered, candidate)) {
    collector.add('release-required', path, message);
  }
}

function compareAdditiveStringList(
  registered: JsonValue | undefined,
  candidate: JsonValue | undefined,
  path: string,
  collector: FindingCollector,
): void {
  if (
    !Array.isArray(registered)
    || registered.some(value => typeof value !== 'string')
    || !Array.isArray(candidate)
    || candidate.some(value => typeof value !== 'string')
  ) {
    compareExact(
      registered,
      candidate,
      path,
      collector,
      'The existing metadata list must remain compatible.',
    );
    return;
  }
  const registeredValues = new Set(registered);
  const candidateValues = new Set(candidate);
  for (const value of registeredValues) {
    if (!candidateValues.has(value)) {
      collector.add(
        'breaking',
        path,
        `Existing value ${value} was removed.`,
      );
    }
  }
  for (const value of candidateValues) {
    if (!registeredValues.has(value)) {
      collector.add(
        'release-required',
        path,
        `Additive value ${value} requires refreshed metadata.`,
      );
    }
  }
}

function compareAdditiveObject(
  registered: JsonValue | undefined,
  candidate: JsonValue | undefined,
  path: string,
  collector: FindingCollector,
): void {
  if (jsonEqual(registered, candidate)) {
    return;
  }
  if (registered === false && candidate === true) {
    collector.add(
      'release-required',
      path,
      'A previously disabled capability was enabled.',
    );
    return;
  }
  const registeredObject = asRecord(registered);
  const candidateObject = asRecord(candidate);
  if (!registeredObject || !candidateObject) {
    collector.add(
      'breaking',
      path,
      'Existing capability metadata changed incompatibly.',
    );
    return;
  }
  for (const key of Object.keys(registeredObject)) {
    if (!(key in candidateObject)) {
      collector.add(
        'breaking',
        `${path}.${key}`,
        'An existing capability was removed.',
      );
      continue;
    }
    compareAdditiveObject(
      registeredObject[key],
      candidateObject[key],
      `${path}.${key}`,
      collector,
    );
  }
  for (const key of Object.keys(candidateObject)) {
    if (!(key in registeredObject)) {
      collector.add(
        'release-required',
        `${path}.${key}`,
        'A new capability requires refreshed metadata.',
      );
    }
  }
}

function compareServerIdentity(
  registered: JsonObject,
  candidate: JsonObject,
  collector: FindingCollector,
): void {
  const releaseKeys = new Set([
    'description',
    'icons',
    'title',
    'version',
    'websiteUrl',
  ]);
  const keys = new Set([
    ...Object.keys(registered),
    ...Object.keys(candidate),
  ]);
  for (const key of keys) {
    const path = `server.identity.${key}`;
    if (key === 'name') {
      compareExact(
        registered[key],
        candidate[key],
        path,
        collector,
        'The MCP server identity name is frozen.',
      );
    } else if (releaseKeys.has(key)) {
      compareReleaseMetadata(
        registered[key],
        candidate[key],
        path,
        collector,
        'Server presentation metadata requires a refresh.',
      );
    } else {
      compareExact(
        registered[key],
        candidate[key],
        path,
        collector,
        'Unknown server identity metadata changed; failing closed.',
      );
    }
  }
}

function compareProtectedResource(
  registered: JsonObject,
  candidate: JsonObject,
  collector: FindingCollector,
): void {
  const exactKeys = new Set([
    'authorization_servers',
    'bearer_methods_supported',
    'resource',
  ]);
  const releaseKeys = new Set([
    'resource_documentation',
    'resource_name',
  ]);
  const keys = new Set([
    ...Object.keys(registered),
    ...Object.keys(candidate),
  ]);
  for (const key of keys) {
    const path = `protectedResource.${key}`;
    if (key === 'scopes_supported') {
      compareAdditiveStringList(
        registered[key],
        candidate[key],
        path,
        collector,
      );
    } else if (exactKeys.has(key)) {
      compareExact(
        registered[key],
        candidate[key],
        path,
        collector,
        'The protected-resource identity and transport are frozen.',
      );
    } else if (releaseKeys.has(key)) {
      compareReleaseMetadata(
        registered[key],
        candidate[key],
        path,
        collector,
        'Protected-resource presentation metadata requires a refresh.',
      );
    } else {
      compareExact(
        registered[key],
        candidate[key],
        path,
        collector,
        'Unknown protected-resource metadata changed; failing closed.',
      );
    }
  }
}

function compareAuthorizationServer(
  registered: JsonObject,
  candidate: JsonObject,
  collector: FindingCollector,
): void {
  const exactKeys = new Set([
    'authorization_endpoint',
    'issuer',
    'revocation_endpoint',
    'token_endpoint',
  ]);
  const additiveListKeys = new Set([
    'code_challenge_methods_supported',
    'grant_types_supported',
    'response_types_supported',
    'revocation_endpoint_auth_methods_supported',
    'scopes_supported',
    'token_endpoint_auth_methods_supported',
  ]);
  const additiveBooleanKeys = new Set([
    'client_id_metadata_document_supported',
    'resource_indicators_supported',
  ]);
  const keys = new Set([
    ...Object.keys(registered),
    ...Object.keys(candidate),
  ]);
  for (const key of keys) {
    const path = `authorizationServer.${key}`;
    if (exactKeys.has(key)) {
      compareExact(
        registered[key],
        candidate[key],
        path,
        collector,
        'OAuth issuer and endpoint identities are frozen.',
      );
    } else if (additiveListKeys.has(key)) {
      compareAdditiveStringList(
        registered[key],
        candidate[key],
        path,
        collector,
      );
    } else if (additiveBooleanKeys.has(key)) {
      const before = registered[key];
      const after = candidate[key];
      if (jsonEqual(before, after)) {
        continue;
      }
      if ((before === false || before === undefined) && after === true) {
        collector.add(
          'release-required',
          path,
          'An additive OAuth capability requires refreshed metadata.',
        );
      } else {
        collector.add(
          'breaking',
          path,
          'An existing OAuth capability was removed or changed.',
        );
      }
    } else {
      compareExact(
        registered[key],
        candidate[key],
        path,
        collector,
        'Unknown authorization-server metadata changed; failing closed.',
      );
    }
  }
}

function compareToolMeta(
  registered: JsonValue | undefined,
  candidate: JsonValue | undefined,
  path: string,
  collector: FindingCollector,
): void {
  if (jsonEqual(registered, candidate)) {
    return;
  }
  const registeredMeta = asRecord(registered);
  const candidateMeta = asRecord(candidate);
  if (
    (registered !== undefined && !registeredMeta)
    || (candidate !== undefined && !candidateMeta)
  ) {
    collector.add(
      'breaking',
      path,
      'Tool _meta changed to an unsupported shape; failing closed.',
    );
    return;
  }

  const before = registeredMeta ?? {};
  const after = candidateMeta ?? {};
  const presentationKeys = new Set([
    'openai/toolInvocation/invoked',
    'openai/toolInvocation/invoking',
  ]);
  const keys = new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ]);
  if (keys.size === 0) {
    collector.add(
      'breaking',
      path,
      'An unclassified empty tool _meta object changed; failing closed.',
    );
    return;
  }
  for (const key of keys) {
    const keyPath = `${path}.${key}`;
    if (presentationKeys.has(key)) {
      compareReleaseMetadata(
        before[key],
        after[key],
        keyPath,
        collector,
        'Tool invocation presentation metadata requires a refresh.',
      );
    } else {
      compareExact(
        before[key],
        after[key],
        keyPath,
        collector,
        key === 'securitySchemes'
          ? 'Existing tool security schemes are frozen.'
          : 'Behavioral or unknown tool _meta changed; failing closed.',
      );
    }
  }
}

function compareTool(
  registered: JsonObject,
  candidate: JsonObject,
  path: string,
  collector: FindingCollector,
): void {
  const releaseKeys = new Set([
    'description',
    'icons',
    'title',
  ]);
  const keys = new Set([
    ...Object.keys(registered),
    ...Object.keys(candidate),
  ]);
  for (const key of keys) {
    const keyPath = `${path}.${key}`;
    if (releaseKeys.has(key)) {
      compareReleaseMetadata(
        registered[key],
        candidate[key],
        keyPath,
        collector,
        'Tool presentation metadata requires a refresh.',
      );
    } else if (key === '_meta') {
      compareToolMeta(
        registered[key],
        candidate[key],
        keyPath,
        collector,
      );
    } else {
      compareExact(
        registered[key],
        candidate[key],
        keyPath,
        collector,
        [
          'inputSchema',
          'outputSchema',
        ].includes(key)
          ? 'Existing tool schemas are frozen; add a new tool for a new shape.'
          : 'Existing tool behavior metadata is frozen.',
      );
    }
  }
}

function toolForProfile(
  contract: McpContractSnapshot,
  profileId: string,
  toolName: string,
): JsonObject {
  const digest = contract.profiles[profileId]?.tools[toolName];
  const tool = digest ? contract.toolVariants[digest] : undefined;
  if (!tool) {
    throw new Error(
      `MCP profile ${profileId} has no contract for ${toolName}.`,
    );
  }
  return tool;
}

function compareProfiles(
  registered: McpContractSnapshot,
  candidate: McpContractSnapshot,
  collector: FindingCollector,
): void {
  const registeredToolNames = new Set(
    Object.values(registered.profiles).flatMap(
      profile => Object.keys(profile.tools),
    ),
  );
  const profileIds = new Set([
    ...Object.keys(registered.profiles),
    ...Object.keys(candidate.profiles),
  ]);
  for (const profileId of profileIds) {
    const before = registered.profiles[profileId];
    const after = candidate.profiles[profileId];
    const path = `profiles.${profileId}`;
    if (!before) {
      collector.add(
        'release-required',
        path,
        'A new contract profile requires reviewed metadata.',
      );
      continue;
    }
    if (!after) {
      collector.add(
        'breaking',
        path,
        'An existing contract profile was removed.',
      );
      continue;
    }
    compareAdditiveStringList(
      before.scopes,
      after.scopes,
      `${path}.scopes`,
      collector,
    );
    compareReleaseMetadata(
      before.instructions,
      after.instructions,
      `${path}.instructions`,
      collector,
      'MCP server instructions require a refresh.',
    );

    const toolNames = new Set([
      ...Object.keys(before.tools),
      ...Object.keys(after.tools),
    ]);
    for (const toolName of toolNames) {
      const toolPath = `${path}.tools.${toolName}`;
      if (!(toolName in before.tools)) {
        if (registeredToolNames.has(toolName)) {
          collector.add(
            'breaking',
            toolPath,
            'An existing tool became available to an additional authorization profile.',
          );
        } else {
          collector.add(
            'release-required',
            toolPath,
            'A new additive tool requires refreshed metadata.',
          );
        }
        continue;
      }
      if (!(toolName in after.tools)) {
        collector.add(
          'breaking',
          toolPath,
          'An existing tool was removed from this authorization profile.',
        );
        continue;
      }
      compareTool(
        toolForProfile(registered, profileId, toolName),
        toolForProfile(candidate, profileId, toolName),
        toolPath,
        collector,
      );
    }
  }
}

export function compareMcpContracts(
  registeredValue: McpContractSnapshot,
  candidateValue: McpContractSnapshot,
): McpContractComparison {
  const registered = normalizeAndValidateSnapshot(registeredValue);
  const candidate = normalizeAndValidateSnapshot(candidateValue);
  const collector = new FindingCollector();

  compareExact(
    registered.formatVersion,
    candidate.formatVersion,
    'formatVersion',
    collector,
    'The MCP contract format changed without a migration.',
  );
  compareExact(
    registered.origin,
    candidate.origin,
    'origin',
    collector,
    'The registered MCP origin is frozen.',
  );
  compareProtectedResource(
    registered.protectedResource,
    candidate.protectedResource,
    collector,
  );
  compareAuthorizationServer(
    registered.authorizationServer,
    candidate.authorizationServer,
    collector,
  );
  compareExact(
    registered.server.protocolVersion,
    candidate.server.protocolVersion,
    'server.protocolVersion',
    collector,
    'The negotiated MCP protocol version is frozen.',
  );
  compareServerIdentity(
    registered.server.identity,
    candidate.server.identity,
    collector,
  );
  compareAdditiveObject(
    registered.server.capabilities,
    candidate.server.capabilities,
    'server.capabilities',
    collector,
  );
  compareProfiles(registered, candidate, collector);
  return collector.result();
}

export interface McpContractGateEvaluation {
  candidateSha256: string;
  comparison: McpContractComparison;
  errors: string[];
}

export function evaluateMcpContractGate(
  registered: RegisteredMcpContract,
  candidateValue: McpContractSnapshot,
  pending: McpContractChangeRecord | null,
): McpContractGateEvaluation {
  const candidate = normalizeAndValidateSnapshot(candidateValue);
  const candidateSha256 = digestMcpContract(candidate);
  const comparison = compareMcpContracts(registered.contract, candidate);
  const errors: string[] = [];

  if (comparison.breaking.length > 0) {
    errors.push(
      'The candidate contains breaking MCP contract changes.',
    );
  }
  if (comparison.releaseRequired.length === 0) {
    if (pending) {
      errors.push(
        'The pending MCP contract change record is stale because no metadata refresh is required.',
      );
    }
  } else if (!pending) {
    errors.push(
      'Metadata changes require a pending MCP contract change record.',
    );
  } else {
    if (pending.candidateSha256 !== candidateSha256) {
      errors.push(
        'The pending MCP contract change digest does not match the candidate.',
      );
    }
    const validActions = registered.lifecycle === 'published'
      ? ['published-version']
      : ['developer-refresh', 'published-version'];
    if (!validActions.includes(pending.lifecycleAction)) {
      errors.push(
        `Lifecycle action ${pending.lifecycleAction} is invalid for ${registered.lifecycle} metadata.`,
      );
    }
  }

  return {
    candidateSha256,
    comparison,
    errors,
  };
}
