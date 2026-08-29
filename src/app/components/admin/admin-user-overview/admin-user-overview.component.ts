import { Component, OnInit, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { buildAdminUserKpiCards } from '../../../helpers/admin-user-kpis.helper';
import { AdminUserAnalyticsStore } from '../../../services/admin-user-analytics.store';
import { AdminUserHistoryComponent } from '../admin-dashboard/admin-user-history.component';
import { AdminUserKpiGridComponent } from '../admin-user-kpi-grid/admin-user-kpi-grid.component';
import { AdminAuthProviderChartComponent } from './admin-auth-provider-chart.component';
import { AdminUserGrowthChartComponent } from './admin-user-growth-chart.component';

@Component({
    selector: 'app-admin-user-overview',
    standalone: true,
    imports: [
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatSnackBarModule,
        MatTooltipModule,
        AdminUserKpiGridComponent,
        AdminAuthProviderChartComponent,
        AdminUserGrowthChartComponent,
        AdminUserHistoryComponent,
    ],
    templateUrl: './admin-user-overview.component.html',
    styleUrls: ['./admin-user-overview.component.scss'],
})
export class AdminUserOverviewComponent implements OnInit {
    readonly analytics = inject(AdminUserAnalyticsStore);
    private readonly snackBar = inject(MatSnackBar);

    readonly kpiCards = computed(() => buildAdminUserKpiCards(
        'full',
        this.analytics.stats(),
        this.analytics.userGrowthTrend(),
        this.analytics.subscriptionHistoryTrend(),
    ));
    readonly refreshInProgress = computed(() => (
        this.analytics.loadingAll()
        || this.analytics.refreshingAll()
        || this.analytics.refreshingEventCount()
        || this.analytics.refreshingRouteCount()
    ));

    ngOnInit(): void {
        void this.analytics.refreshAll();
    }

    refreshAll(): void {
        void this.analytics.refreshAll();
    }

    async refreshEventCount(): Promise<void> {
        try {
            await this.analytics.refreshEventCount();
            this.snackBar.open('Event count refreshed', undefined, { duration: 3000 });
        } catch {
            this.snackBar.open('Failed to refresh event count', undefined, { duration: 5000 });
        }
    }

    async refreshRouteCount(): Promise<void> {
        try {
            await this.analytics.refreshRouteCount();
            this.snackBar.open('Route count refreshed', undefined, { duration: 3000 });
        } catch {
            this.snackBar.open('Failed to refresh route count', undefined, { duration: 5000 });
        }
    }
}
