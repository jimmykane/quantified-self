import { Injectable, inject } from '@angular/core';
import { Auth, type FirebaseUserType } from 'app/firebase/auth';
import { Firestore, doc, runTransaction } from 'app/firebase/firestore';
import { firstValueFrom, from, timeout, finalize } from 'rxjs';
import { parseWorkoutPowerSettingsV1, type WorkoutPowerSettingsV1 } from '@shared/workout-power-settings';
import { AppUserService } from './app.user.service';

@Injectable({ providedIn: 'root' })
export class WorkoutPowerSettingsService {
  private readonly db = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly users = inject(AppUserService);
  private current(uid: string, session: FirebaseUserType | null): boolean {
    return !!uid && !!session && session === this.auth.currentUser && session.uid === uid && this.users.user()?.uid === uid;
  }
  async load(uid: string): Promise<WorkoutPowerSettingsV1> {
    const session = this.auth.currentUser;
    let active = true;
    const assertCurrent = () => { if (!active || !this.current(uid, session)) throw Error('The signed-in account changed.'); };
    return firstValueFrom(from((async () => {
      assertCurrent();
      // A cached missing settings document is not evidence of an empty profile list.
      const { getFirestore, doc, getDoc } = await import('firebase/firestore/lite');
      assertCurrent();
      const snapshot = await getDoc(doc(getFirestore(this.db.app), 'users', uid, 'config', 'settings'));
      assertCurrent();
      return parseWorkoutPowerSettingsV1(snapshot.data()?.['workoutPower']);
    })()).pipe(timeout(30000), finalize(() => { active = false; })));
  }
  async save(uid: string, previous: WorkoutPowerSettingsV1, profiles: WorkoutPowerSettingsV1['profiles']): Promise<WorkoutPowerSettingsV1> {
    const before = parseWorkoutPowerSettingsV1(previous);
    const next = parseWorkoutPowerSettingsV1({ version: 1, revision: before.revision + 1, profiles });
    const session = this.auth.currentUser;
    let active = true;
    const assertCurrent = () => { if (!active || !this.current(uid, session)) throw Error('The signed-in account changed.'); };
    return firstValueFrom(from((async () => {
      assertCurrent();
      const ref = doc(this.db, 'users', uid, 'config', 'settings');
      const result = await runTransaction(this.db, async tx => {
        assertCurrent();
        const snapshot = await tx.get(ref);
        const existing = parseWorkoutPowerSettingsV1(snapshot.data()?.['workoutPower']);
        if (JSON.stringify(existing) === JSON.stringify(next)) return existing;
        if (JSON.stringify(existing) !== JSON.stringify(before)) throw Error('Power settings changed in another session. Reload before saving.');
        assertCurrent();
        tx.set(ref, { workoutPower: next }, { merge: true });
        return next;
      });
      assertCurrent();
      return result;
    })()).pipe(timeout(30000), finalize(() => { active = false; })));
  }
}
