import { inject, Injectable } from '@angular/core';
import { collection, collectionData, doc, docData, Firestore, runTransaction, serverTimestamp,
  query, where, limit } from 'app/firebase/firestore';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { combineLatest, map, Observable, of, startWith, switchMap } from 'rxjs';
import { DEFAULT_TRAINING_LOAD_POLICY, isTrainingLoadMethod, resolveEffectiveTrainingLoad, validTrainingLoadOverride,
  type EffectiveTrainingLoad, type TrainingLoadActivity, type TrainingLoadControl, type TrainingLoadMetadata, type TrainingLoadPolicy } from '@shared/training-load-policy';
import { isTrainingDiscipline, type TrainingSportId } from '@shared/training-disciplines';
import { AppUserService } from './app.user.service';
import { browserTrainingLoadSourceFingerprint, canonicalTrainingLoadValue } from '@shared/training-load-source';

export interface TrainingLoadView extends EffectiveTrainingLoad { updatedAtMs?: number; }
export interface TrainingLoadPolicyHead extends TrainingLoadPolicy { id: TrainingSportId; revision: number; }
export type TrainingLoadEdit = { key: string; control: TrainingLoadControl | null }
  | { excluded: boolean } | { reset: true };

@Injectable({ providedIn: 'root' })
export class TrainingLoadService {
  private readonly firestore = inject(Firestore);
  private readonly users = inject(AppUserService);

  watch(uid: string, eventId: string): Observable<TrainingLoadMetadata | null> {
    return this.users.user$.pipe(switchMap(user => user?.uid === uid
      ? docData(doc(this.firestore, `users/${uid}/events/${eventId}/metaData/trainingLoad`)).pipe(
        map(data => data ? data as TrainingLoadMetadata : null))
      : of(null)));
  }

  watchPolicies(uid: string): Observable<TrainingLoadPolicyHead[]> {
    return collectionData(collection(this.firestore, `users/${uid}/trainingLoadPolicies`), { idField: 'id' }) as Observable<TrainingLoadPolicyHead[]>;
  }

  watchEffective(uid: string, events: readonly EventInterface[]): Observable<Map<string, TrainingLoadView>> {
    if (!events.length) return of(new Map());
    return combineLatest(events.map(event => this.watch(uid, event.getID() as string).pipe(switchMap(metadata => {
      const loaded = event.getActivities().map(activity => ({ ...activity.toJSON(), id: activity.getID() as string,
        type: activity.type, getStat: activity.getStat.bind(activity) }));
      const legs = Object.values(metadata?.legs ?? {}).filter(leg => leg.activityId);
      const needsSources = metadata && !metadata.excluded && !metadata.sourceWritePending && !loaded.length
        && (legs.length || (!metadata.legs && Object.keys(metadata.controls).length));
      // Calendar summaries have no hydrated legs. Watch only the selected workout,
      // so child-only corrections/deletions cannot leave impact showing old candidates.
      // Event details already receive live hydrated legs and need no additional query.
      const sources$: Observable<(TrainingLoadActivity & Record<string, unknown>)[] | null> = needsSources
        ? collectionData(query(collection(this.firestore, `users/${uid}/activities`),
          where('eventID', '==', event.getID()), limit(101)), { idField: 'id' }).pipe(map(children => {
            if (children.length > 100) throw new Error('Too many workout legs.');
            return children as (TrainingLoadActivity & Record<string, unknown>)[];
          }), startWith(null))
        : of(loaded);
      return sources$.pipe(switchMap(async activities => {
        const timestamp = metadata?.updatedAt as { toMillis?: () => number } | undefined;
        let stale = activities === null;
        if (!stale && metadata && !metadata.excluded && !metadata.sourceWritePending) {
          stale = !!metadata.parentFingerprint && metadata.parentFingerprint !==
            await browserTrainingLoadSourceFingerprint(event.toJSON?.() ?? event);
          if (!stale && metadata.legs) {
            const current = new Map(activities!.map(activity => [activity.id, activity]));
            const matches = await Promise.all(legs.map(async leg => {
              const activity = current.get(leg.activityId!);
              return !!activity && (!leg.sourceFingerprint || leg.sourceFingerprint ===
                await browserTrainingLoadSourceFingerprint(activity));
            }));
            stale = matches.some(matchesSource => !matchesSource);
          }
        }
        const resolved = stale ? { score: null, status: 'unavailable' as const, method: null,
          estimated: false, reasons: ['source-updating'] } : resolveEffectiveTrainingLoad(event, metadata, activities ?? []);
        return [event.getID() as string, { ...resolved, updatedAtMs: timestamp?.toMillis?.() ?? 0 }] as const;
      }));
    })))).pipe(map(entries => new Map(entries)));
  }

  async save(uid: string, eventId: string, expectedRevision: number, edit: TrainingLoadEdit,
    future?: { family: TrainingSportId; policy: TrainingLoadPolicy; expectedRevision: number }): Promise<void> {
    if ('key' in edit && edit.control) this.validateControl(edit.control);
    if (future) this.validatePolicy(future.family, future.policy);
    const eventRef = doc(this.firestore, `users/${uid}/events/${eventId}`);
    const ref = doc(this.firestore, `users/${uid}/events/${eventId}/metaData/trainingLoad`);
    const policyRef = future ? doc(this.firestore, `users/${uid}/trainingLoadPolicies/${future.family}`) : null;
    const revisionId = crypto.randomUUID();
    await runTransaction(this.firestore, async transaction => {
      const event = await transaction.get(eventRef);
      const snapshot = await transaction.get(ref);
      const policySnapshot = policyRef ? await transaction.get(policyRef) : null;
      if (!event.exists()) throw new Error('This workout no longer exists.');
      const current = snapshot.data() as TrainingLoadMetadata | undefined;
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Training load changed elsewhere. Reopen the editor and try again.');
      if (future && (policySnapshot?.data()?.['revision'] ?? 0) !== future.expectedRevision)
        throw new Error('Sport preferences changed elsewhere. Reopen the editor and try again.');
      const controls = { ...current?.controls };
      if ('key' in edit) {
        if (edit.control) controls[edit.key] = edit.control;
        else delete controls[edit.key];
      }
      const patch = { version: 1, revision: expectedRevision + 1,
        excluded: 'reset' in edit ? false : 'excluded' in edit ? edit.excluded : current?.excluded ?? false,
        controls: 'reset' in edit ? {} : controls, resetUnmatched: 'reset' in edit ? true : current?.resetUnmatched ?? false, editedLegKey: 'key' in edit ? edit.key : null, updatedAt: serverTimestamp() };
      const changed = !current || patch.excluded !== current.excluded
        || patch.resetUnmatched !== (current.resetUnmatched ?? false)
        // Firestore map field order can differ from the editor's object order.
        // Unchanged controls must not advance freshness without a load rebuild.
        || JSON.stringify(canonicalTrainingLoadValue(patch.controls)) !== JSON.stringify(canonicalTrainingLoadValue(current.controls));
      if (changed) {
        if (snapshot.exists()) transaction.update(ref, patch);
        else transaction.set(ref, patch);
      }
      if (future && policyRef) {
        const policy = { ...future.policy, revision: future.expectedRevision + 1, revisionId, effectiveAt: serverTimestamp() };
        transaction.set(policyRef, policy);
        transaction.set(doc(policyRef, 'revisions', revisionId), policy);
      }
    });
  }

  async savePolicy(uid: string, family: TrainingSportId, expectedRevision: number, policy: TrainingLoadPolicy): Promise<void> {
    this.validatePolicy(family, policy);
    const ref = doc(this.firestore, `users/${uid}/trainingLoadPolicies/${family}`);
    const revisionId = crypto.randomUUID();
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(ref);
      if ((snapshot.data()?.['revision'] ?? 0) !== expectedRevision) throw new Error('Preferences changed elsewhere. Reload and try again.');
      const next = { ...policy, revision: expectedRevision + 1, revisionId, effectiveAt: serverTimestamp() };
      transaction.set(ref, next);
      transaction.set(doc(ref, 'revisions', revisionId), next);
    });
  }

  private validatePolicy(family: unknown, policy: TrainingLoadPolicy): void {
    if (!isTrainingDiscipline(family) || !isTrainingLoadMethod(policy.method) || typeof policy.included !== 'boolean')
      throw new Error('Choose a valid sport preference.');
  }
  private validateControl(control: TrainingLoadControl): void {
    if ((control.method !== undefined && !isTrainingLoadMethod(control.method)) ||
      (control.override !== undefined && !validTrainingLoadOverride(control.override)) ||
      (control.included !== undefined && typeof control.included !== 'boolean')) throw new Error('Enter a TSS between 0 and 9999.');
  }
}

export { DEFAULT_TRAINING_LOAD_POLICY };
