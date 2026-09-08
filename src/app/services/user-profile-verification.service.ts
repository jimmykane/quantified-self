import { Injectable, inject } from '@angular/core';
import { Auth, FirebaseUserType } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { getUserLegalAgreementsPath } from '@shared/user-profile-firestore';
import { AppUserInterface } from '../models/app-user.interface';
import { REQUIRED_POLICY_CONSENT_FORM_CONTROL_NAMES } from '../shared/policy-consent-fields';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { firstValueFrom, from, throwError, timeout } from 'rxjs';

export interface UserProfileDocuments {
  user?: Partial<AppUserInterface>;
  legal?: Record<string, unknown>;
  system?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export function mergeUserProfileDocuments(userID: string, documents: UserProfileDocuments): AppUserInterface | null {
  const { user, legal, system, settings } = documents;
  const hasData = (value: object | undefined) => !!value && Object.keys(value).length > 0;
  if (!user && !hasData(legal) && !hasData(system) && !hasData(settings)) {
    return null;
  }

  // Preserve the existing legacy profile -> legal -> system precedence.
  const profile = { ...user, ...legal, ...system } as AppUserInterface;
  profile.uid = userID;
  if (hasData(settings)) {
    profile.settings = settings as unknown as AppUserInterface['settings'];
  }
  profile.settings = AppUserUtilities.fillMissingAppSettings(profile);
  return profile;
}

@Injectable({ providedIn: 'root' })
export class UserProfileVerificationService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly pendingReads = new Map<string, {
    firebaseUser: FirebaseUserType | null;
    profile: AppUserInterface | null;
    read: Promise<AppUserInterface | null>;
  }>();

  invalidatePendingRead(userID: string): void {
    // The SDK request itself cannot be cancelled. Stop sharing its result
    // once a newer snapshot or profile-load attempt supersedes it.
    this.pendingReads.delete(userID);
  }

  needsVerification(profile: AppUserInterface | null): boolean {
    return !profile || !REQUIRED_POLICY_CONSENT_FORM_CONTROL_NAMES.every(name =>
      profile[name.replace(/^accept/, 'accepted') as keyof AppUserInterface] === true
    );
  }

  verifyIfIncomplete(userID: string, profile: AppUserInterface | null): Promise<AppUserInterface | null> {
    if (!this.needsVerification(profile)) {
      this.invalidatePendingRead(userID);
      return Promise.resolve(profile);
    }

    const firebaseUser = this.auth.currentUser;
    const pending = this.pendingReads.get(userID);
    if (pending && pending.firebaseUser === firebaseUser && pending.profile === profile) {
      return pending.read;
    }

    // Bound the shared request too: a stalled read must not remain memoized
    // forever and prevent a later manual retry from making a fresh request.
    const read = firstValueFrom(from(this.readFromServer(userID)).pipe(timeout({
      first: 10_000,
      with: () => throwError(() => Object.assign(new Error('Timed out verifying the account profile.'), {
        code: 'deadline-exceeded',
      })),
    }))).finally(() => {
      if (this.pendingReads.get(userID)?.read === read) {
        this.pendingReads.delete(userID);
      }
    });
    this.pendingReads.set(userID, { firebaseUser, profile, read });
    return read;
  }

  private async readFromServer(userID: string): Promise<AppUserInterface | null> {
    const firebaseUser = this.auth.currentUser;
    const assertCurrentUser = () => {
      if (!firebaseUser || firebaseUser.uid !== userID || this.auth.currentUser !== firebaseUser) {
        throw Object.assign(new Error('The signed-in account changed during profile verification.'), { code: 'cancelled' });
      }
    };
    assertCurrentUser();

    // The full SDK's getDocFromServer still uses the watch/local-store path and
    // can repeat an incorrect persisted NoDocument result. Lite reads use REST,
    // with the same app's Auth and App Check providers, without that cache.
    // Load it only on the exceptional/incomplete profile path.
    const { getFirestore, doc, getDoc } = await import('firebase/firestore/lite');
    assertCurrentUser();
    const firestore = getFirestore(this.firestore.app);
    const [user, legal, system, settings] = await Promise.all([
      `users/${userID}`,
      getUserLegalAgreementsPath(userID),
      `users/${userID}/system/status`,
      `users/${userID}/config/settings`,
    ].map(async path => (await getDoc(doc(firestore, path))).data()));
    assertCurrentUser();
    return mergeUserProfileDocuments(userID, { user, legal, system, settings });
  }
}
