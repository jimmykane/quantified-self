import { TestBed } from '@angular/core/testing';
import { AppProcessingService, BackgroundJob } from './app.processing.service';

describe('AppProcessingService', () => {
    let service: AppProcessingService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(AppProcessingService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should add a job and emit it via jobs$', (done) => {
        service.jobs$.subscribe(jobs => {
            if (jobs.length > 0) {
                expect(jobs.length).toBe(1);
                expect(jobs[0].title).toBe('Test Job');
                expect(jobs[0].status).toBe('processing');
                done();
            }
        });
        service.addJob('upload', 'Test Job');
    });

    it('should update a job', (done) => {
        const jobId = service.addJob('upload', 'Test Job');

        service.jobs$.subscribe(jobs => {
            const job = jobs.find(j => j.id === jobId);
            if (job && job.progress === 50) {
                expect(job.title).toBe('Updated Title');
                done();
            }
        });

        service.updateJob(jobId, { progress: 50, title: 'Updated Title' });
    });

    it('should complete a job', (done) => {
        const jobId = service.addJob('upload', 'Test Job');

        service.jobs$.subscribe(jobs => {
            const job = jobs.find(j => j.id === jobId);
            if (job && job.status === 'completed') {
                expect(job.progress).toBe(100);
                expect(job.details).toBe('Done');
                done();
            }
        });

        service.completeJob(jobId, 'Done');
    });

    it('should fail a job', (done) => {
        const jobId = service.addJob('upload', 'Test Job');

        service.jobs$.subscribe(jobs => {
            const job = jobs.find(j => j.id === jobId);
            if (job && job.status === 'failed') {
                expect(job.details).toBe('Error');
                done();
            }
        });

        service.failJob(jobId, 'Error');
    });

    it('should remove a job', (done) => {
        const jobId = service.addJob('upload', 'Test Job');

        // First subscribe to verify addition (logic simplified for test)
        service.removeJob(jobId);

        service.jobs$.subscribe(jobs => {
            if (jobs.length === 0) {
                expect(jobs.length).toBe(0);
                done();
            }
        });
    });

    it('activeJobs$ should only return processing or pending jobs', (done) => {
        const job1 = service.addJob('upload', 'Job 1'); // processing by default
        const job2 = service.addJob('download', 'Job 2'); // processing by default
        service.completeJob(job1); // completed

        service.activeJobs$.subscribe(activeJobs => {
            if (activeJobs.length === 1) {
                expect(activeJobs[0].id).toBe(job2);
                done();
            }
        });
    });
});
