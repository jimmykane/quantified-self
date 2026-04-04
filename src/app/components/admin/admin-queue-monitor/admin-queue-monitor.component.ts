import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { AdminService, QueueStats } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { AdminQueueStatsComponent, AdminQueueStatsView } from '../admin-queue-stats/admin-queue-stats.component';

@Component({
    selector: 'app-admin-queue-monitor',
    templateUrl: './admin-queue-monitor.component.html',
    styleUrls: ['./admin-queue-monitor.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        MatButtonModule,
        MatIconModule,
        AdminQueueStatsComponent
    ]
})
export class AdminQueueMonitorComponent implements OnInit, OnDestroy {
    queueStats: QueueStats | null = null;
    isLoadingStats = true;
    queueView: AdminQueueStatsView = 'all';
    pageTitle = 'Queue Monitoring';
    pageSubtitle = 'Operational health for ingestion, reparse, and derived metrics pipelines';

    private readonly destroy$ = new Subject<void>();

    constructor(
        private readonly adminService: AdminService,
        private readonly logger: LoggerService,
        private readonly route: ActivatedRoute
    ) { }

    ngOnInit(): void {
        this.configureView();
        this.fetchQueueStats();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private configureView(): void {
        const rawView = this.route.snapshot.data['queueView'];
        if (rawView === 'workout' || rawView === 'reparse' || rawView === 'derived') {
            this.queueView = rawView;
        } else {
            this.queueView = 'all';
        }

        if (this.queueView === 'workout') {
            this.pageTitle = 'Workout Queue';
            this.pageSubtitle = 'Monitor ingestion queue throughput, lag, retries, and provider health';
            return;
        }

        if (this.queueView === 'reparse') {
            this.pageTitle = 'Sports-lib Reparse Queue';
            this.pageSubtitle = 'Monitor reparse jobs, checkpoint progress, and failure diagnostics';
            return;
        }

        if (this.queueView === 'derived') {
            this.pageTitle = 'Derived Metrics Queue';
            this.pageSubtitle = 'Monitor derived metrics queue depth, coordinator status, and failure diagnostics';
            return;
        }

        this.pageTitle = 'Queue Monitoring';
        this.pageSubtitle = 'Operational health for ingestion, reparse, and derived metrics pipelines';
    }

    fetchQueueStats(): void {
        this.isLoadingStats = true;
        this.adminService.getQueueStats(true).pipe(takeUntil(this.destroy$)).subscribe({
            next: (stats) => {
                this.queueStats = stats;
                this.isLoadingStats = false;
            },
            error: (err) => {
                this.logger.error('Failed to load queue stats:', err);
                this.isLoadingStats = false;
            }
        });
    }
}
