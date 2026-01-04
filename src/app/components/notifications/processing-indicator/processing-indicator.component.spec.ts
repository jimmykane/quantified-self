import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ProcessingIndicatorComponent } from './processing-indicator.component';
import { AppProcessingService, BackgroundJob } from '../../../services/app.processing.service';
import { BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

describe('ProcessingIndicatorComponent', () => {
    let component: ProcessingIndicatorComponent;
    let fixture: ComponentFixture<ProcessingIndicatorComponent>;
    let mockProcessingService: Partial<AppProcessingService>;
    let activeJobsSubject: BehaviorSubject<BackgroundJob[]>;
    let allJobsSubject: BehaviorSubject<BackgroundJob[]>;

    beforeEach(async () => {
        activeJobsSubject = new BehaviorSubject<BackgroundJob[]>([]);
        allJobsSubject = new BehaviorSubject<BackgroundJob[]>([]);

        mockProcessingService = {
            activeJobs$: activeJobsSubject.asObservable(),
            jobs$: allJobsSubject.asObservable(),
            removeJob: (() => { }) as any,
            hasActiveJobs$: activeJobsSubject.pipe(map(jobs => jobs.length > 0))
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
        activeJobsSubject.next([
            { id: '1', title: 'Job 1', status: 'processing', type: 'upload', createdAt: Date.now() },
            { id: '2', title: 'Job 2', status: 'processing', type: 'download', createdAt: Date.now() }
        ]);
        fixture.detectChanges();

        component.activeJobs$.subscribe(jobs => {
            expect(jobs.length).toBe(2);
        });
    });

    it('should identify if processing is active', () => {
        // No jobs
        component.hasActiveJobs$.subscribe(hasActive => {
            expect(hasActive).toBeFalse();
        });

        // Add jobs
        activeJobsSubject.next([
            { id: '1', title: 'Job 1', status: 'processing', type: 'upload', createdAt: Date.now() }
        ]);

        component.hasActiveJobs$.subscribe(hasActive => {
            expect(hasActive).toBeTrue();
        });
    });
});
