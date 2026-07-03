import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import {
    AdminService,
    FinancialStats,
    MaintenanceStatus,
    QueueStats,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse
} from '../../../services/admin.service';
import { RouterModule } from '@angular/router';

import { forkJoin, of, Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';

import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LoggerService } from '../../../services/logger.service';
import { AdminFinancialsComponent } from '../admin-financials/admin-financials.component';
import { AppWhatsNewService } from '../../../services/app.whats-new.service';
import {
    buildAdminDashboardChangelogSummary,
    buildAdminDashboardHealthSummary,
    buildAdminDashboardMaintenanceCards,
    buildAdminDashboardQueueRows,
    buildAdminDashboardUserKpiCards
} from '../../../helpers/admin-dashboard-summary.helper';
import { CompactCountPipe } from '../../../helpers/compact-count.pipe';

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
        MatCardModule,
        MatChipsModule,
        MatTableModule,
        MatTooltipModule,
        RouterModule,
        AdminFinancialsComponent,
        CompactCountPipe
    ]
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
    private readonly adminService = inject(AdminService);
    private readonly logger = inject(LoggerService);
    private readonly whatsNewService = inject(AppWhatsNewService);

    readonly financialStats = signal<FinancialStats | null>(null);
    readonly isLoadingFinancials = signal(true);
    readonly financialError = signal<string | null>(null);

    readonly userStats = signal<UserCountStats | null>(null);
    readonly userGrowthTrend = signal<UserGrowthTrendResponse | null>(null);
    readonly subscriptionHistoryTrend = signal<SubscriptionHistoryTrendResponse | null>(null);
    readonly isLoadingUsers = signal(true);
    readonly userError = signal<string | null>(null);

    readonly queueStats = signal<QueueStats | null>(null);
    readonly isLoadingQueues = signal(true);
    readonly queueError = signal<string | null>(null);

    readonly maintenanceStatus = signal<MaintenanceStatus | null>(null);
    readonly isLoadingMaintenance = signal(true);
    readonly maintenanceError = signal<string | null>(null);

    readonly queueDisplayedColumns = ['queue', 'pendingDb', 'cloudTasks', 'completed', 'problems', 'dead', 'throughput', 'lag', 'details', 'actions'];

    readonly userKpiCards = computed(() => buildAdminDashboardUserKpiCards(
        this.userStats(),
        this.userGrowthTrend(),
        this.subscriptionHistoryTrend()
    ));
    readonly queueRows = computed(() => buildAdminDashboardQueueRows(this.queueStats()));
    readonly maintenanceCards = computed(() => buildAdminDashboardMaintenanceCards(this.maintenanceStatus()));
    readonly changelogSummary = computed(() => buildAdminDashboardChangelogSummary(this.whatsNewService.changelogs()));
    readonly healthSummary = computed(() => buildAdminDashboardHealthSummary(
        this.queueRows(),
        this.maintenanceCards(),
        this.changelogSummary(),
        this.financialStats()
    ));

    private readonly destroy$ = new Subject<void>();
    private releaseChangelogAdminMode: (() => void) | null = null;

    ngOnInit(): void {
        this.releaseChangelogAdminMode = this.whatsNewService.requestAdminMode();
        this.fetchFinancialStats();
        this.fetchUserOverview();
        this.fetchQueueStats();
        this.fetchMaintenanceStatus();
    }

    fetchFinancialStats(): void {
        this.isLoadingFinancials.set(true);
        this.financialError.set(null);
        this.adminService.getFinancialStats().pipe(takeUntil(this.destroy$)).subscribe({
            next: (stats) => {
                this.financialStats.set(stats);
                this.isLoadingFinancials.set(false);
            },
            error: (err) => {
                this.logger.error('Failed to load financial stats:', err);
                this.financialError.set('Financial stats are unavailable.');
                this.isLoadingFinancials.set(false);
            }
        });
    }

    fetchUserOverview(): void {
        this.isLoadingUsers.set(true);
        this.userError.set(null);
        forkJoin({
            stats: this.adminService.getTotalUserCount(),
            userGrowthTrend: this.adminService.getUserGrowthTrend(12).pipe(
                catchError((err) => {
                    this.logger.error('Failed to load admin user growth trend:', err);
                    return of(null);
                })
            ),
            subscriptionHistoryTrend: this.adminService.getSubscriptionHistoryTrend(12).pipe(
                catchError((err) => {
                    this.logger.error('Failed to load admin subscription history trend:', err);
                    return of(null);
                })
            ),
        }).pipe(takeUntil(this.destroy$)).subscribe({
            next: ({ stats, userGrowthTrend, subscriptionHistoryTrend }) => {
                this.userStats.set(stats);
                this.userGrowthTrend.set(userGrowthTrend);
                this.subscriptionHistoryTrend.set(subscriptionHistoryTrend);
                this.isLoadingUsers.set(false);
            },
            error: (err) => {
                this.logger.error('Failed to load admin user overview:', err);
                this.userError.set('User KPIs are unavailable.');
                this.isLoadingUsers.set(false);
            }
        });
    }

    fetchQueueStats(): void {
        this.isLoadingQueues.set(true);
        this.queueError.set(null);
        this.adminService.getQueueStats(true).pipe(takeUntil(this.destroy$)).subscribe({
            next: (stats) => {
                this.queueStats.set(stats);
                this.isLoadingQueues.set(false);
            },
            error: (err) => {
                this.logger.error('Failed to load admin queue stats:', err);
                this.queueError.set('Queue stats are unavailable.');
                this.isLoadingQueues.set(false);
            }
        });
    }

    fetchMaintenanceStatus(): void {
        this.isLoadingMaintenance.set(true);
        this.maintenanceError.set(null);
        this.adminService.getMaintenanceStatus().pipe(takeUntil(this.destroy$)).subscribe({
            next: (status) => {
                this.maintenanceStatus.set(status);
                this.isLoadingMaintenance.set(false);
            },
            error: (err) => {
                this.logger.error('Failed to load maintenance status:', err);
                this.maintenanceError.set('Maintenance status is unavailable.');
                this.isLoadingMaintenance.set(false);
            }
        });
    }

    ngOnDestroy(): void {
        this.releaseChangelogAdminMode?.();
        this.releaseChangelogAdminMode = null;
        this.destroy$.next();
        this.destroy$.complete();
    }
}
