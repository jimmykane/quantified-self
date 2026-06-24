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
    pageSubtitle = 'Operational health for ingestion, route delivery sync, route import sync, activity sync, sleep sync, reparse, and derived metrics pipelines';

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
        if (
            rawView === 'workout' ||
            rawView === 'activity-sync' ||
            rawView === 'route-delivery-sync' ||
            rawView === 'route-sync' ||
            rawView === 'sleep-sync' ||
            rawView === 'reparse' ||
            rawView === 'route-reparse' ||
            rawView === 'derived'
        ) {
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
            this.pageTitle = 'Event Reparse Queue';
            this.pageSubtitle = 'Monitor event sports-lib reparse jobs, checkpoint progress, and failure diagnostics';
            return;
        }

        if (this.queueView === 'route-reparse') {
            this.pageTitle = 'Route Reparse Queue';
            this.pageSubtitle = 'Monitor route sports-lib reparse jobs, checkpoint progress, and failure diagnostics';
            return;
        }

        if (this.queueView === 'activity-sync') {
            this.pageTitle = 'Activity Sync Queue';
            this.pageSubtitle = 'Monitor cross-service activity sync queue depth';
            return;
        }

        if (this.queueView === 'route-delivery-sync') {
            this.pageTitle = 'Route Delivery Sync Queue';
            this.pageSubtitle = 'Monitor saved route delivery sync from Quantified Self to destination providers';
            return;
        }

        if (this.queueView === 'route-sync') {
            this.pageTitle = 'Route Sync Queue';
            this.pageSubtitle = 'Monitor provider route import queue depth, skips, retries, and failure diagnostics';
            return;
        }

        if (this.queueView === 'sleep-sync') {
            this.pageTitle = 'Sleep Sync Queue';
            this.pageSubtitle = 'Monitor sleep sync queue depth, provider disablement, retries, and failures';
            return;
        }

        if (this.queueView === 'derived') {
            this.pageTitle = 'Derived Metrics Queue';
            this.pageSubtitle = 'Monitor derived metrics queue depth, coordinator status, and failure diagnostics';
            return;
        }

        this.pageTitle = 'Queue Monitoring';
        this.pageSubtitle = 'Operational health for ingestion, route delivery sync, route import sync, activity sync, sleep sync, reparse, and derived metrics pipelines';
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
