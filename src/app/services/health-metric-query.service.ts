import { effect, inject, Injectable } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';
import { AppHealthService, type HealthWorkspaceRangeRequest, type HealthWorkspaceRangeLoad } from './app.health.service';
import { AppSleepService } from './app.sleep.service';
import { AppUserService } from './app.user.service';
import { HealthActivityQueryService } from '../components/health/health-activity-query.service';
import type { ActivityHealthRangeRequest, ActivityHealthRangeResult } from '@shared/activity-health';
import type { SleepSession } from '@shared/sleep';
interface ReadJob {
    generation: number;
    key: string;
    uid: string;
    priority: number;
    run: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}
interface CachedRead {
    uid: string;
    promise: Promise<unknown>;
    expires: number;
    job: ReadJob;
    persistent: boolean;
    listeners: Set<symbol>;
}
/** One bounded queue/cache for Health explorer, dashboard tiles and previews. */
@Injectable({ providedIn: 'root' })
export class HealthMetricQueryService {
    private readonly health = inject(AppHealthService);
    private readonly sleep = inject(AppSleepService);
    private readonly activities = inject(HealthActivityQueryService);
    private readonly users = inject(AppUserService);
    private readonly cache = new Map<string, CachedRead>();
    private readonly queue: ReadJob[] = [];
    private active = 0;
    private generation = 0;
    private owner: string | null = null;
    readonly invalidated$ = new Subject<string>();
    constructor() {
        this.owner = this.users.user()?.uid || null;
        effect(() => this.syncOwner());
    }
    private syncOwner(): void {
        const uid = this.users.user()?.uid || null;
        if (this.owner === uid)
            return;
        this.owner = uid;
        this.generation++;
        this.cache.clear();
        for (const job of this.queue.splice(0))
            job.reject(new Error('Health account changed.'));
    }
    isOwner(uid: string): boolean { return !!uid && this.users.user()?.uid === uid; }
    loadMetricRange(uid: string, request: HealthWorkspaceRangeRequest, priority = 10, signal?: AbortSignal): Promise<HealthWorkspaceRangeLoad> {
        return this.read(uid, ['metric', request.metricId, request.startDate, request.endDate, request.includeSamples], () => this.health.loadMetricRange(uid, request), priority, signal);
    }
    loadActivityRange(uid: string, request: ActivityHealthRangeRequest, priority = 10, signal?: AbortSignal): Promise<ActivityHealthRangeResult> {
        return this.read(uid, ['activity', request.metricId, request.startTimeMs, request.endTimeMs], () => this.activities.loadRange(request), priority, signal);
    }
    loadSleepRange(uid: string, startMs: number, endMs: number, priority = 10, signal?: AbortSignal): Promise<SleepSession[]> {
        return this.read(uid, ['sleep', startMs, endMs], () => firstValueFrom(this.sleep.watchForDashboard(uid, startMs, endMs)), priority, signal);
    }
    invalidate(uid: string): void {
        for (const [key, entry] of this.cache)
            if (entry.uid === uid)
                this.cache.delete(key);
        this.invalidated$.next(uid);
    }
    private read<T>(uid: string, parts: unknown[], run: () => Promise<T>, priority: number, signal?: AbortSignal): Promise<T> {
        this.syncOwner();
        if (signal?.aborted)
            return Promise.reject(new DOMException('Health read cancelled.', 'AbortError'));
        if (!this.isOwner(uid))
            return Promise.reject(new Error('Health data is only available to its owner.'));
        const key = JSON.stringify([uid, ...parts]);
        const cached = this.cache.get(key);
        if (cached && cached.expires > Date.now()) {
            const queued = this.queue.find(job => job.key === key);
            if (queued)
                queued.priority = Math.max(priority, queued.priority);
            this.retain(cached, signal);
            return cached.promise as Promise<T>;
        }
        let job!: ReadJob;
        const promise = new Promise<T>((resolve, reject) => { job = { generation: this.generation, key, uid, priority, run, resolve, reject }; this.queue.push(job); });
        const entry: CachedRead = { uid, promise, job, expires: Infinity, persistent: false, listeners: new Set() };
        this.retain(entry, signal);
        this.cache.set(key, entry);
        // Keep completed reads briefly for scroll/remount and hub-to-dashboard navigation.
        void promise.then(() => {
            entry.expires = Date.now() + 60000;
            const completed = [...this.cache].filter(([, value]) => value.expires !== Infinity);
            for (const [oldKey] of completed.slice(0, Math.max(0, completed.length - 12)))
                this.cache.delete(oldKey);
        }, () => { if (this.cache.get(key) === entry)
            this.cache.delete(key); });
        this.drain();
        return promise;
    }
    private retain(entry: CachedRead, signal?: AbortSignal): void {
        if (!signal) {
            entry.persistent = true;
            return;
        }
        const token = Symbol();
        entry.listeners.add(token);
        const release = () => {
            entry.listeners.delete(token);
            signal.removeEventListener('abort', release);
            const index = this.queue.indexOf(entry.job);
            if (signal.aborted && !entry.persistent && !entry.listeners.size && index >= 0) {
                this.queue.splice(index, 1);
                entry.job.reject(new DOMException('Health read cancelled.', 'AbortError'));
                if (this.cache.get(entry.job.key) === entry)
                    this.cache.delete(entry.job.key);
            }
        };
        signal.addEventListener('abort', release, { once: true });
        void entry.promise.then(release, release);
    }
    private drain(): void {
        this.queue.sort((a, b) => b.priority - a.priority);
        while (this.active < 3 && this.queue.length) {
            const job = this.queue.shift()!;
            if (!this.isOwner(job.uid)) {
                job.reject(new Error('Health account changed.'));
                continue;
            }
            this.active++;
            void Promise.resolve().then(job.run).then(value => {
                if (!this.isOwner(job.uid) || job.generation !== this.generation)
                    throw new Error('Health account changed.');
                job.resolve(value);
            }).catch(error => job.reject(error)).finally(() => { this.active--; this.drain(); });
        }
    }
}
