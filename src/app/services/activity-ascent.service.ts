import { Injectable, inject } from '@angular/core';
import { Auth } from '../firebase/auth';
import { Firestore, collection, doc, getDocFromServer, getDocsFromServer, limit, query, where } from '../firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { isTerrainAscentActivity, readActivityAscent, readAscentCorrection,
  type ActivityAscentCorrection, type ActivityAscentUpdate } from '@shared/activity-ascent';
import { isBenchmarkEvent } from '@shared/event-classification';
import { browserTrainingLoadSourceFingerprint, trainingLoadTimeMs } from '@shared/training-load-source';

export interface ActivityAscentRow {
  id: string;
  label: string;
  value: number | null;
  correction: ActivityAscentCorrection | null;
  fingerprint: string;
}

@Injectable({ providedIn: 'root' })
export class ActivityAscentService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly functions = inject(AppFunctionsService);

  private owner(uid: string): void {
    if (this.auth.currentUser?.uid !== uid) throw new Error('Sign in as the recording owner to edit ascent.');
  }

  async load(uid: string, eventId: string): Promise<ActivityAscentRow[]> {
    this.owner(uid);
    const [parent, children] = await Promise.all([
      getDocFromServer(doc(this.firestore, 'users', uid, 'events', eventId)),
      getDocsFromServer(query(collection(this.firestore, 'users', uid, 'activities'), where('eventID', '==', eventId), limit(101))),
    ]);
    this.owner(uid);
    if (!parent.exists() || isBenchmarkEvent(parent.data())) throw new Error('This recording cannot be edited.');
    if (children.size > 100) throw new Error('This recording has too many activities to edit.');
    const sources = children.docs.map(child => ({ id: child.id, data: child.data() }))
      .filter(child => isTerrainAscentActivity(child.data['type']))
      .sort((left, right) => trainingLoadTimeMs(left.data['startDate']) - trainingLoadTimeMs(right.data['startDate']));
    return Promise.all(sources.map(async (child, index) => ({
      id: child.id, label: `Activity ${index + 1} · ${child.data['type']}`,
      value: readActivityAscent(child.data['stats']), correction: readAscentCorrection(child.data['ascentCorrection']),
      fingerprint: await browserTrainingLoadSourceFingerprint(child.data),
    })));
  }

  async save(uid: string, eventId: string, row: ActivityAscentRow, ascent: number | null): Promise<ActivityAscentUpdate> {
    this.owner(uid);
    const response = await this.functions.call<unknown, { ascent: ActivityAscentUpdate }>('reprocessEvent', { eventId, mode: 'correct_ascent', expectedOwner: uid,
      edit: { activityId: row.id, ascent, expectedSourceFingerprint: row.fingerprint, expectedCorrection: row.correction } });
    return response.data.ascent;
  }
}
