import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';


export type JobType = 'upload' | 'download' | 'process';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'duplicate';

export interface BackgroundJob {
    id: string;
    type: JobType;
    title: string;
    status: JobStatus;
    progress?: number; // 0-100
    details?: string;
    createdAt: number;
}

@Injectable({
    providedIn: 'root'
})
export class AppProcessingService {
    private jobsSubject = new BehaviorSubject<BackgroundJob[]>([]);
    public jobs$ = this.jobsSubject.asObservable();
    private completedCleanupTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private readonly completedCleanupDelayMs = 5000;

    // Derived observables
    public activeJobs$ = this.jobs$.pipe(
        map(jobs => jobs.filter(j => j.status === 'processing' || j.status === 'pending'))
    );

    public hasActiveJobs$ = this.activeJobs$.pipe(
        map(jobs => jobs.length > 0)
    );

    constructor() { }

    /**
     * Starts a new job and returns its ID
     */
    addJob(type: JobType, title: string): string {
        const id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const newJob: BackgroundJob = {
            id,
            type,
            title,
            status: 'pending',
            progress: 0,
            createdAt: Date.now()
        };

        this.jobsSubject.next([newJob, ...this.jobsSubject.value]);
        this.scheduleCompletedCleanup();
        return id;
    }

    updateJob(id: string, updates: Partial<Omit<BackgroundJob, 'id' | 'createdAt'>>) {
        const currentJobs = this.jobsSubject.value;
        const index = currentJobs.findIndex(j => j.id === id);
        if (index !== -1) {
            const previousStatus = currentJobs[index].status;
            const updatedJob = { ...currentJobs[index], ...updates };
            const newJobs = [...currentJobs];
            newJobs[index] = updatedJob;
            this.jobsSubject.next(newJobs);
            if (previousStatus !== updatedJob.status) {
                this.scheduleCompletedCleanup();
            }
        }
    }

    completeJob(id: string, details?: string) {
        this.updateJob(id, { status: 'completed', progress: 100, details });
    }

    failJob(id: string, error?: string) {
        this.updateJob(id, { status: 'failed', details: error });
        // Keep failed jobs visible longer for user awareness
        setTimeout(() => {
            this.removeJob(id);
        }, 10000);
    }

    removeJob(id: string) {
        const newJobs = this.jobsSubject.value.filter(j => j.id !== id);
        this.jobsSubject.next(newJobs);
        this.scheduleCompletedCleanup();
    }

    private scheduleCompletedCleanup() {
        if (this.completedCleanupTimeoutId) {
            clearTimeout(this.completedCleanupTimeoutId);
            this.completedCleanupTimeoutId = null;
        }
        const hasActiveJobs = this.jobsSubject.value.some((job) => job.status === 'processing' || job.status === 'pending');
        if (hasActiveJobs) {
            return;
        }
        const hasCompletedJobs = this.jobsSubject.value.some((job) => job.status === 'completed' || job.status === 'duplicate');
        if (!hasCompletedJobs) {
            return;
        }
        this.completedCleanupTimeoutId = setTimeout(() => {
            const remainingJobs = this.jobsSubject.value.filter(
                (job) => job.status !== 'completed' && job.status !== 'duplicate'
            );
            this.jobsSubject.next(remainingJobs);
            this.completedCleanupTimeoutId = null;
        }, this.completedCleanupDelayMs);
    }
}
