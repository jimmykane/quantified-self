import { Injectable, Injector, computed, inject, runInInjectionContext, signal } from '@angular/core';
import { Firestore, collection, collectionData, query, orderBy, where, Timestamp, addDoc, doc, updateDoc, deleteDoc, QueryConstraint } from '@angular/fire/firestore';
import { AppWhatsNewLocalStorageService } from './storage/app.whats-new.local.storage.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { map, shareReplay, switchMap } from 'rxjs/operators';
import { AppUserService } from './app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { LoggerService } from './logger.service';
import { BehaviorSubject } from 'rxjs';

export interface ChangelogPost {
    id: string;
    title: string;
    description: string;
    date: Timestamp;
    published: boolean;
    image?: string;
    version?: string;
    type: 'major' | 'minor' | 'patch' | 'announcement';
}

@Injectable({
    providedIn: 'root'
})
export class AppWhatsNewService {
    private authService = inject(AppAuthService);
    private userService = inject(AppUserService);
    private firestore = inject(Firestore);
    private logger = inject(LoggerService);
    private localStorage = inject(AppWhatsNewLocalStorageService);
    private injector = inject(Injector);

    private readonly changelogsCollection = collection(this.firestore, 'changelogs');

    private _isAdminMode = signal(false);

    // Derived query that changes based on admin mode
    private changelogsQuery = computed(() => {
        if (this._isAdminMode()) {
            // Admin mode: Show all, ordered by date
            return query(this.changelogsCollection, orderBy('date', 'desc'));
        } else {
            // User mode: Show only published
            return query(this.changelogsCollection, where('published', '==', true), orderBy('date', 'desc'));
        }
    });

    // Re-create observable stream based on the computed query
    private changelogs$ = toObservable(this.changelogsQuery, { injector: this.injector }).pipe(
        switchMap(q => runInInjectionContext(this.injector, () => collectionData(q, { idField: 'id' }))),
        map(changelogs => changelogs as ChangelogPost[]),
        shareReplay(1)
    );

    public readonly changelogs = toSignal(this.changelogs$, { initialValue: [] });
    private readonly user = toSignal(this.authService.user$, { initialValue: null });
    private _localStorageTrigger = signal(0);

    // Get the current user's last seen date from appSettings
    // defaulting to a very old date if not set
    private userLastSeenDate = computed(() => {
        // Trigger dependency on local storage updates
        this._localStorageTrigger();

        const user = this.user();
        if (!user) {
            // Fallback for guest users
            const local = this.localStorage.getItem('whats_new_last_seen');
            return local ? new Date(local) : new Date(0);
        }

        // Check nested generic settings first, if we move it there as per plan
        const settings = user.settings?.appSettings as any;
        if (settings && settings.lastSeenChangelogDate) {
            // It might be a Firestore Timestamp or a serialized date string/object
            // Safe handle:
            const val = settings.lastSeenChangelogDate;
            if (val instanceof Timestamp) return val.toDate();
            if (typeof val === 'string') return new Date(val);
            if (val instanceof Date) return val;
            if (val && typeof val.seconds === 'number') return new Date(val.seconds * 1000);
        }

        return new Date(0); // Never seen
    });

    public isUnread(log: ChangelogPost): boolean {
        const lastSeen = this.userLastSeenDate();
        const logDate = log.date instanceof Timestamp ? log.date.toDate() : new Date(log.date);
        return logDate > lastSeen;
    }

    public readonly unreadCount = computed(() => {
        const logs = this.changelogs();
        const lastSeen = this.userLastSeenDate();

        if (!logs.length) return 0;

        return logs.filter(log => {
            const logDate = log.date instanceof Timestamp ? log.date.toDate() : new Date(log.date);
            return logDate > lastSeen;
        }).length;
    });

    public async markAsRead() {
        const now = new Date();
        this.logger.info('[AppWhatsNewService] Marking changelogs as read', now);

        const user = this.user();
        if (!user) {
            this.localStorage.setItem('whats_new_last_seen', now.toISOString());
            // For guests, we need to trigger re-evaluation. 
            this._localStorageTrigger.set(this._localStorageTrigger() + 1);
            return;
        }

        const settingsUpdate = {
            appSettings: {
                lastSeenChangelogDate: now
            }
        };

        await this.userService.updateUserProperties(user, { settings: settingsUpdate });
    }

    // Admin Methods
    public setAdminMode(isAdmin: boolean) {
        this._isAdminMode.set(isAdmin);
    }

    public async createChangelog(post: Omit<ChangelogPost, 'id'>) {
        await addDoc(this.changelogsCollection, post);
    }

    public async updateChangelog(id: string, data: Partial<ChangelogPost>) {
        const docRef = doc(this.firestore, 'changelogs', id);
        await updateDoc(docRef, data);
    }

    public async deleteChangelog(id: string) {
        const docRef = doc(this.firestore, 'changelogs', id);
        await deleteDoc(docRef);
    }
}
