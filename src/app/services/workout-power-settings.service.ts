import { Injectable, inject } from '@angular/core';
import { Auth, type FirebaseUserType } from 'app/firebase/auth';
import { Firestore, doc, runTransaction } from 'app/firebase/firestore';
import { firstValueFrom, from, timeout, finalize } from 'rxjs';
import { parseWorkoutPowerSettingsV1, sharedWorkoutFtpReference, workoutFtpFamily, type SharedWorkoutFtpReferenceV1, type WorkoutPowerProfileV1, type WorkoutPowerReferenceV1, type WorkoutPowerSettingsV1 } from '@shared/workout-power-settings';
import { dayWorkoutLocalDate } from '@shared/day-workout';
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
  async loadSharedFtp(uid: string, sport: WorkoutPowerProfileV1['sport']): Promise<SharedWorkoutFtpReferenceV1 | null> {
    const session = this.auth.currentUser;
    let active = true;
    const assertCurrent = () => { if (!active || !this.current(uid, session)) throw Error('The signed-in account changed.'); };
    return firstValueFrom(from((async () => {
      assertCurrent();
      const family = workoutFtpFamily(sport);
      if (!family) return null;
      const { getFirestore, doc, getDoc } = await import('firebase/firestore/lite');
      assertCurrent();
      const snapshot = await getDoc(doc(getFirestore(this.db.app), 'users', uid, 'trainingLoadPolicies', family));
      assertCurrent();
      const policy = snapshot.data();
      const reference = sharedWorkoutFtpReference(sport, policy, Date.now());
      if (policy?.['functionalThresholdPower'] !== undefined && !reference) throw Error('The shared FTP could not be verified.');
      return reference;
    })()).pipe(timeout(30000), finalize(() => { active = false; })));
  }
  /** Advisory check for generation options; the server still resolves the reference at generation time. */
  async loadReference(uid: string, sport: WorkoutPowerProfileV1['sport'], timeZone: string): Promise<WorkoutPowerReferenceV1 | null> {
    const session = this.auth.currentUser;
    const settings = await this.load(uid);
    if (!this.current(uid, session)) throw Error('The signed-in account changed.');
    const override = settings.profiles.find(profile => profile.sport === sport);
    if (override) {
      if (override.referenceDate > dayWorkoutLocalDate(new Date(), timeZone)) throw Error('The power override is future dated.');
      return override;
    }
    const shared = await this.loadSharedFtp(uid, sport);
    if (!this.current(uid, session)) throw Error('The signed-in account changed.');
    return shared;
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
