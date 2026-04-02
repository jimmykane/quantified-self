import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { Firestore, collection, collectionData, query, orderBy, where, Timestamp, addDoc, doc, updateDoc, deleteDoc } from 'app/firebase/firestore';
import { AppWhatsNewLocalStorageService } from './storage/app.whats-new.local.storage.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { map, shareReplay, switchMap } from 'rxjs/operators';
import { AppUserService } from './app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { LoggerService } from './logger.service';
import { AppDateValue } from '../models/app-date-value.type';

export type ChangelogPostDate = AppDateValue;

export function coerceChangelogPostDate(value: unknown): Date | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof Timestamp) {
        return value.toDate();
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === 'object') {
        if ('toDate' in value && typeof value.toDate === 'function') {
            const parsed = value.toDate();
            return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
        }

        if ('seconds' in value && typeof value.seconds === 'number') {
            const nanoseconds = 'nanoseconds' in value && typeof value.nanoseconds === 'number'
                ? value.nanoseconds
                : 0;
            const parsed = new Date((value.seconds * 1000) + Math.floor(nanoseconds / 1_000_000));
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
    }

    return null;
}

export interface ChangelogPost {
    id: string;
    title: string;
    description: string;
    date: ChangelogPostDate;
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

    // Derived query that changes based on admin mode.
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
    public changelogs$ = toObservable(this.changelogsQuery, { injector: this.injector }).pipe(
        switchMap(q => collectionData(q, { idField: 'id' })),
        map(changelogs => changelogs as ChangelogPost[]),
        shareReplay(1)
    );

    public readonly changelogs = toSignal(this.changelogs$, { initialValue: [] });
    private readonly user = toSignal(this.authService.user$, { initialValue: null });
    private _localStorageTrigger = signal(0);

    // Get the current user's last seen date from appSettings
    // defaulting to account creation for first-time users
    private userLastSeenDate = computed(() => {
        // Trigger dependency on local storage updates
        this._localStorageTrigger();

        const user = this.user();
        if (!user) {
            // Fallback for guest users
            const local = this.localStorage.getItem('whats_new_last_seen');
            return coerceChangelogPostDate(local) ?? new Date(0);
        }

        // Check nested generic settings first, if we move it there as per plan
        const settings = user.settings?.appSettings;
        if (settings && settings.lastSeenChangelogDate) {
            const lastSeenDate = coerceChangelogPostDate(settings.lastSeenChangelogDate);
            if (lastSeenDate) {
                return lastSeenDate;
            }
        }

        const creationDate = coerceChangelogPostDate(user.creationDate);
        if (creationDate) {
            return creationDate;
        }

        return new Date(0); // Never seen
    });

    public isUnread(log: ChangelogPost): boolean {
        const lastSeen = this.userLastSeenDate();
        const logDate = coerceChangelogPostDate(log.date);
        if (!logDate) {
            return false;
        }
        return logDate > lastSeen;
    }

    public readonly unreadCount = computed(() => {
        const logs = this.changelogs();
        const user = this.user();

        if (!logs.length) return 0;
        if (!user) return 0;

        const lastSeen = this.userLastSeenDate();

        return logs.filter(log => {
            const logDate = coerceChangelogPostDate(log.date);
            if (!logDate) {
                return false;
            }
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
