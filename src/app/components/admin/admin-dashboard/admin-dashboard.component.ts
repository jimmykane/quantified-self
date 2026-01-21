import { Component, OnInit, OnDestroy } from '@angular/core';
import { AdminService, QueueStats, FinancialStats } from '../../../services/admin.service';
import { RouterModule } from '@angular/router';

import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { LoggerService } from '../../../services/logger.service';
import { AdminFinancialsComponent } from '../admin-financials/admin-financials.component';
import { AdminQueueStatsComponent } from '../admin-queue-stats/admin-queue-stats.component';

@Component({
    selector: 'app-admin-dashboard',
    templateUrl: './admin-dashboard.component.html',
    styleUrls: ['./admin-dashboard.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatButtonModule,
        RouterModule,
        AdminFinancialsComponent,
        AdminQueueStatsComponent
    ]
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
    // Queue stats
    queueStats: QueueStats | null = null;
    isLoadingStats = true;

    // Financial stats
    financialStats: FinancialStats | null = null;
    isLoadingFinancials = true;

    // Cleanup
    private destroy$ = new Subject<void>();

    constructor(
        private adminService: AdminService,
        private logger: LoggerService
    ) { }

    ngOnInit(): void {
        this.fetchQueueStats();
        this.fetchFinancialStats();
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

    fetchFinancialStats(): void {
        this.isLoadingFinancials = true;
        this.adminService.getFinancialStats().pipe(takeUntil(this.destroy$)).subscribe({
            next: (stats) => {
                this.financialStats = stats;
                this.isLoadingFinancials = false;
            },
            error: (err) => {
                this.logger.error('Failed to load financial stats:', err);
                this.isLoadingFinancials = false;
            }
        });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }
}
