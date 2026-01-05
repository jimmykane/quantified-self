import { Component, ChangeDetectionStrategy } from '@angular/core';
import { AppProcessingService, BackgroundJob } from '../../../services/app.processing.service';
import { map } from 'rxjs/operators';

@Component({
    selector: 'app-processing-indicator',
    templateUrl: './processing-indicator.component.html',
    styleUrls: ['./processing-indicator.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ProcessingIndicatorComponent {
    jobs$;
    activeJobs$;
    hasActiveJobs$;
    activeJobsProgress$;

    constructor(public processingService: AppProcessingService) {
        this.jobs$ = this.processingService.jobs$;
        this.activeJobs$ = this.processingService.activeJobs$;
        this.hasActiveJobs$ = this.processingService.hasActiveJobs$;

        this.activeJobsProgress$ = this.activeJobs$.pipe(
            map((jobs: BackgroundJob[]) => {
                if (!jobs || jobs.length === 0) return 0;
                const totalProgress = jobs.reduce((acc, job) => acc + (job.progress || 0), 0);
                return totalProgress / jobs.length;
            })
        );
    }

    removeJob(id: string) {
        this.processingService.removeJob(id);
    }
}
