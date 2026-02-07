import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ProcessingIndicatorComponent } from './processing-indicator.component';
import { AppProcessingService, BackgroundJob } from '../../../services/app.processing.service';
import { BehaviorSubject } from 'rxjs';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

describe('ProcessingIndicatorComponent', () => {
    let component: ProcessingIndicatorComponent;
    let fixture: ComponentFixture<ProcessingIndicatorComponent>;
    let mockProcessingService: Partial<AppProcessingService>;
    let allJobsSubject: BehaviorSubject<BackgroundJob[]>;

    beforeEach(async () => {
        allJobsSubject = new BehaviorSubject<BackgroundJob[]>([]);

        mockProcessingService = {
            jobs$: allJobsSubject.asObservable(),
            removeJob: (() => { }) as any
        };

        await TestBed.configureTestingModule({
            declarations: [ProcessingIndicatorComponent],
            imports: [
                CommonModule,
                MatMenuModule,
                MatIconModule,
                MatBadgeModule,
                MatProgressSpinnerModule,
                MatDividerModule,
                MatChipsModule,
                MatButtonModule,
                MatProgressBarModule,
                NoopAnimationsModule
            ],
            providers: [
                { provide: AppProcessingService, useValue: mockProcessingService }
            ]
        })
            .compileComponents();

        fixture = TestBed.createComponent(ProcessingIndicatorComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should display active job count', () => {
        allJobsSubject.next([
            { id: '1', title: 'Job 1', status: 'processing', type: 'upload', createdAt: Date.now() },
            { id: '2', title: 'Job 2', status: 'pending', type: 'download', createdAt: Date.now() },
            { id: '3', title: 'Job 3', status: 'completed', type: 'download', createdAt: Date.now() }
        ]);
        fixture.detectChanges();

        expect(component.activeJobs().length).toBe(2);
    });

    it('should identify if processing is active', () => {
        // No jobs initially
        expect(component.hasActiveJobs()).toBe(false);

        // Add active job
        allJobsSubject.next([
            { id: '1', title: 'Job 1', status: 'processing', type: 'upload', createdAt: Date.now() }
        ]);
        fixture.detectChanges();

        expect(component.hasActiveJobs()).toBe(true);
    });

    it('should calculate overall progress based on completed jobs', () => {
        allJobsSubject.next([
            { id: '1', title: 'Job 1', status: 'completed', type: 'upload', createdAt: Date.now() },
            { id: '2', title: 'Job 2', status: 'processing', type: 'upload', createdAt: Date.now() }
        ]);
        fixture.detectChanges();

        const progress = component.overallProgress();
        expect(progress).toBe(50); // 1 of 2 jobs finished
    });

    it('should return 0 progress if no jobs', () => {
        allJobsSubject.next([]);
        fixture.detectChanges();
        const progress = component.overallProgress();
        expect(progress).toBe(0);
    });

    it('should treat finished jobs as complete when progress is missing', () => {
        allJobsSubject.next([
            { id: '1', title: 'Job 1', status: 'completed', type: 'upload', createdAt: Date.now() },
            { id: '2', title: 'Job 2', status: 'failed', type: 'upload', createdAt: Date.now() },
            { id: '3', title: 'Job 3', status: 'pending', type: 'upload', createdAt: Date.now() }
        ]);
        fixture.detectChanges();

        expect(component.overallProgress()).toBe(67);
    });
});
