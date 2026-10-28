import { describe, expect, it } from 'vitest';
import { createOAuthFirestoreHarness } from './oauth-firestore-harness';

describe('OAuth Firestore fixture', () => {
  it('keeps roots, nested tokens, users and providers independent', async () => {
    const fixture = createOAuthFirestoreHarness();
    const connection = fixture.connection('providerTokens', 'owner');
    connection.seedRoot({ oauthFlowGeneration: 'flow-a' });
    connection.replaceProviderToken('account-a', { accessToken: 'synthetic-a' });
    connection.replaceProviderToken('account-b', { accessToken: 'synthetic-b' });
    fixture.connection('providerTokens', 'other-owner').replaceProviderToken('account-a', { accessToken: 'other' });
    fixture.connection('otherProvider', 'owner').seedRoot({ oauthFlowGeneration: 'other' });
    await connection.token('account-a').delete();
    expect(connection.readRoot()).toEqual({ oauthFlowGeneration: 'flow-a' });
    expect(connection.readToken('account-b')).toEqual({ accessToken: 'synthetic-b' });
    expect((await connection.tokens.get()).docs.map(doc => doc.id)).toEqual(['account-b']);
    expect(fixture.connection('providerTokens', 'other-owner').readToken('account-a')).toBeDefined();
    await connection.root.delete();
    expect(connection.readToken('account-b')).toBeDefined();
  });

  it('returns stable references and copied read snapshots', async () => {
    const fixture = createOAuthFirestoreHarness();
    const connection = fixture.connection('providerTokens', 'owner');
    connection.seedRoot({ oauthFlowGeneration: 'flow-a' });
    const snapshot = await connection.root.get();
    connection.setOAuthFlow({ oauthFlowGeneration: 'flow-b' });
    expect(snapshot.data()).toEqual({ oauthFlowGeneration: 'flow-a' });
    expect(fixture.db.collection('providerTokens').doc('owner')).toBe(connection.root);
    expect(connection.token('account').parent.parent).toBe(connection.root);
  });

  it('merges, removes fields and replaces documents deliberately', async () => {
    const connection = createOAuthFirestoreHarness().connection('providerTokens', 'owner');
    connection.seedRoot({ state: 'old', retained: true });
    await connection.root.set({ state: 'delete-sentinel', oauthFlowGeneration: 'flow' }, { merge: true });
    expect(connection.readRoot()).toEqual({ retained: true, oauthFlowGeneration: 'flow' });
    await connection.root.set({ state: 'new' });
    expect(connection.readRoot()).toEqual({ state: 'new' });
    connection.removeRoot();
    await expect(connection.root.update({ state: 'invalid' })).rejects.toThrow('missing fixture document');
  });

  it('stages transaction writes and discards them when the callback fails', async () => {
    const fixture = createOAuthFirestoreHarness();
    const connection = fixture.connection('providerTokens', 'owner');
    connection.seedRoot({ state: 'before' });
    await expect(fixture.db.runTransaction(async transaction => {
      transaction.set(connection.root, { state: 'after' });
      expect(connection.readRoot()).toEqual({ state: 'before' });
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(fixture.setDocument).not.toHaveBeenCalled();
    expect(connection.readRoot()).toEqual({ state: 'before' });
  });

  it('preserves write order and rolls back a failed multi-document commit', async () => {
    const fixture = createOAuthFirestoreHarness();
    const connection = fixture.connection('providerTokens', 'owner');
    connection.seedRoot({ state: 'before' });
    connection.token('account').set.mockRejectedValueOnce(new Error('write failed'));
    await expect(fixture.db.runTransaction(async transaction => {
      transaction.set(connection.root, { state: 'after' });
      transaction.set(connection.token('account'), { accessToken: 'synthetic' });
    })).rejects.toThrow('write failed');
    expect(connection.readRoot()).toEqual({ state: 'before' });
    await fixture.db.runTransaction(async transaction => {
      transaction.set(connection.root, { state: 'first' });
      transaction.delete(connection.root);
      transaction.set(connection.root, { state: 'last' });
    });
    expect(connection.readRoot()).toEqual({ state: 'last' });
  });

  it('applies named competing transitions without overwriting unrelated root state', () => {
    const connection = createOAuthFirestoreHarness().connection('providerTokens', 'owner');
    connection.setOAuthFlow({ state: 'pending-state', oauthFlowGeneration: 'flow' });
    connection.persistCredentials('account', { accessToken: 'synthetic', tokenCredentialGeneration: 'credential' });
    connection.setDisconnectGeneration({ disconnectOperationGeneration: 'disconnect' });
    connection.replaceProviderToken('account', { accessToken: 'refreshed', tokenCredentialGeneration: 'credential' });
    expect(connection.readRoot()).toEqual({
      state: 'pending-state', oauthFlowGeneration: 'flow',
      activeOAuthCredentialGeneration: 'credential', disconnectOperationGeneration: 'disconnect',
    });
    expect(connection.readToken('account')).toEqual({ accessToken: 'refreshed', tokenCredentialGeneration: 'credential' });
  });

  it('rejects reads after staged writes without committing changes', async () => {
    const fixture = createOAuthFirestoreHarness();
    const connection = fixture.connection('providerTokens', 'owner');
    await expect(fixture.db.runTransaction(async transaction => {
      transaction.set(connection.root, { state: 'pending' });
      await transaction.get(connection.root);
    })).rejects.toThrow('reads must precede writes');
    expect(connection.readRoot()).toBeUndefined();
  });

  it('starts each fixture with independent document state and spies', async () => {
    const first = createOAuthFirestoreHarness().connection('providerTokens', 'owner');
    await first.root.set({ state: 'first' });
    const second = createOAuthFirestoreHarness().connection('providerTokens', 'owner');
    expect(second.readRoot()).toBeUndefined();
    expect(second.root.set).not.toHaveBeenCalled();
  });

  it('filters collection-group results by provider identity and service', async () => {
    const fixture = createOAuthFirestoreHarness();
    fixture.connection('wahoo', 'owner-a').replaceProviderToken('account', { wahooUserID: 'account', serviceName: 'wahooAPI' });
    fixture.connection('wahoo', 'owner-b').replaceProviderToken('other', { wahooUserID: 'other', serviceName: 'wahooAPI' });
    fixture.connection('otherProvider', 'owner-c').replaceProviderToken('account', { wahooUserID: 'account', serviceName: 'other' });
    const result = await fixture.db.collectionGroup('tokens').where('wahooUserID', '==', 'account')
      .where('serviceName', '==', 'wahooAPI').get();
    expect(result.docs.map(doc => doc.ref.path)).toEqual(['wahoo/owner-a/tokens/account']);
  });
});
