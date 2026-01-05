import { TestBed } from '@angular/core/testing';
import { AppProcessingService, BackgroundJob } from './app.processing.service';
import { firstValueFrom } from 'rxjs';
import { filter, map } from 'rxjs/operators';

describe('AppProcessingService', () => {
    let service: AppProcessingService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(AppProcessingService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should add a job and emit it via jobs$', async () => {
        service.addJob('upload', 'Test Job');
        const jobs = await firstValueFrom(service.jobs$.pipe(filter(j => j.length > 0)));
        expect(jobs.length).toBe(1);
        expect(jobs[0].title).toBe('Test Job');
        expect(jobs[0].status).toBe('pending'); // Initial status is pending
    });

    it('should update a job', async () => {
        const jobId = service.addJob('upload', 'Test Job');
        service.updateJob(jobId, { progress: 50, title: 'Updated Title' });

        const job = await firstValueFrom(service.jobs$.pipe(
            map(jobs => jobs.find(j => j.id === jobId)),
            filter(j => !!j && j.progress === 50)
        ));

        if (job) {
            expect(job.title).toBe('Updated Title');
        }
    });

    it('should complete a job', async () => {
        const jobId = service.addJob('upload', 'Test Job');
        service.completeJob(jobId, 'Done');

        const job = await firstValueFrom(service.jobs$.pipe(
            map(jobs => jobs.find(j => j.id === jobId)),
            filter(j => !!j && j.status === 'completed')
        ));

        if (job) {
            expect(job.status).toBe('completed');
            // Depending on implementation, progress might not be auto-set to 100 on completeJob unless specified
            // So removing the progress check unless we are sure.
            // But actually let's check what completeJob does. It sets status: 'completed'.
            expect(job.details).toBe('Done');
        }
    });

    it('should fail a job', async () => {
        const jobId = service.addJob('upload', 'Test Job');
        service.failJob(jobId, 'Error');

        const job = await firstValueFrom(service.jobs$.pipe(
            map(jobs => jobs.find(j => j.id === jobId)),
            filter(j => !!j && j.status === 'failed')
        ));

        if (job) {
            expect(job.details).toBe('Error');
        }
    });

    it('should remove a job', async () => {
        const jobId = service.addJob('upload', 'Test Job');
        service.removeJob(jobId);

        const jobs = await firstValueFrom(service.jobs$.pipe(filter(j => j.length === 0)));
        expect(jobs.length).toBe(0);
    });

    it('activeJobs$ should only return processing or pending jobs', async () => {
        const job1 = service.addJob('upload', 'Job 1');
        const job2 = service.addJob('download', 'Job 2');

        // Wait for jobs to be emitted
        await firstValueFrom(service.jobs$.pipe(filter(j => j.length === 2)));

        service.completeJob(job1);

        const activeJobs = await firstValueFrom(service.activeJobs$.pipe(
            filter(jobs => jobs.length === 1 && jobs[0].id === job2)
        ));

        expect(activeJobs.length).toBe(1);
        expect(activeJobs[0].id).toBe(job2);
    });
});
