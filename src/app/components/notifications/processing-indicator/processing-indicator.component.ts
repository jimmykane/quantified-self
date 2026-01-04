import { Component, ChangeDetectionStrategy } from '@angular/core';
import { AppProcessingService } from '../../../services/app.processing.service';

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

    constructor(public processingService: AppProcessingService) {
        this.jobs$ = this.processingService.jobs$;
        this.activeJobs$ = this.processingService.activeJobs$;
        this.hasActiveJobs$ = this.processingService.hasActiveJobs$;
    }

    removeJob(id: string) {
        this.processingService.removeJob(id);
    }
}
