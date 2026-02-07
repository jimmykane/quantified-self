import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ThemePalette } from '@angular/material/core';
import { AppProcessingService, BackgroundJob, JobStatus } from '../../../services/app.processing.service';

@Component({
    selector: 'app-processing-indicator',
    templateUrl: './processing-indicator.component.html',
    styleUrls: ['./processing-indicator.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ProcessingIndicatorComponent {
    private readonly processingService = inject(AppProcessingService);

    readonly jobs = toSignal(this.processingService.jobs$, { initialValue: [] as BackgroundJob[] });
    readonly activeJobs = computed(() => this.jobs().filter((job) => this.isActiveJob(job.status)));
    readonly hasActiveJobs = computed(() => this.activeJobs().length > 0);
    readonly totalJobsCount = computed(() => this.jobs().length);
    readonly activeJobsCount = computed(() => this.activeJobs().length);
    readonly finishedJobsCount = computed(() => this.jobs().filter((job) => this.isFinishedJob(job.status)).length);
    readonly overallProgress = computed(() => this.calculateOverallProgress(this.jobs()));
    readonly progressMode = computed<'determinate' | 'indeterminate'>(() => {
        if (!this.hasActiveJobs()) {
            return 'determinate';
        }
        return this.overallProgress() === 0 ? 'indeterminate' : 'determinate';
    });

    readonly statusSummary = computed(() => {
        const total = this.totalJobsCount();
        if (total === 0) {
            return 'No active tasks';
        }
        const finished = this.finishedJobsCount();
        if (this.hasActiveJobs()) {
            return `Done ${finished}/${total}`;
        }
        return `All ${total} done`;
    });

    readonly statusLabelMap: Record<JobStatus, string> = {
        pending: 'Pending',
        processing: 'Processing',
        completed: 'Completed',
        failed: 'Failed',
        duplicate: 'Duplicate'
    };

    readonly statusColorMap: Record<JobStatus, ThemePalette | undefined> = {
        pending: undefined,
        processing: 'accent',
        completed: 'primary',
        failed: 'warn',
        duplicate: 'accent'
    };

    removeJob(id: string) {
        this.processingService.removeJob(id);
    }

    private calculateOverallProgress(jobs: BackgroundJob[]): number {
        if (jobs.length === 0) {
            return 0;
        }
        const finished = jobs.filter((job) => this.isFinishedJob(job.status)).length;
        return Math.round((finished / jobs.length) * 100);
    }

    private isActiveJob(status: JobStatus): boolean {
        return status === 'processing' || status === 'pending';
    }

    private isFinishedJob(status: JobStatus): boolean {
        return status === 'completed' || status === 'failed' || status === 'duplicate';
    }
}
