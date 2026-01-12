import { Component, Input, Output, EventEmitter, ViewChild, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort, MatSort } from '@angular/material/sort';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { AdminUser } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';

export interface UserStats {
    total: number;
    pro: number;
    basic: number;
    free: number;
    providers?: Record<string, number>;
}

@Component({
    selector: 'app-admin-user-management',
    templateUrl: './admin-user-management.component.html',
    styleUrls: ['./admin-user-management.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatButtonModule,
        MatTooltipModule,
        MatTableModule,
        MatPaginatorModule,
        MatSortModule,
        MatInputModule,
        MatFormFieldModule,
        BaseChartDirective
    ],
    providers: [provideCharts(withDefaultRegisterables())]
})
export class AdminUserManagementComponent implements OnInit, OnChanges, OnDestroy {
    @ViewChild(MatSort) sort!: MatSort;

    // Inputs
    @Input() users: AdminUser[] = [];
    @Input() userStats: UserStats | null = null;
    @Input() isLoading = false;
    @Input() error: string | null = null;
    @Input() totalCount = 0;
    @Input() currentPage = 0;
    @Input() pageSize = 10;
    @Input() pageSizeOptions: number[] = [5, 10, 25, 50];

    // Outputs
    @Output() pageChange = new EventEmitter<PageEvent>();
    @Output() sortChange = new EventEmitter<Sort>();
    @Output() searchChange = new EventEmitter<string>();
    @Output() impersonate = new EventEmitter<AdminUser>();

    displayedColumns: string[] = [
        'photoURL', 'email', 'providerIds', 'displayName', 'role', 'subscription',
        'services', 'created', 'lastLogin', 'status', 'actions'
    ];

    searchTerm = '';
    private searchSubject = new Subject<string>();
    private destroy$ = new Subject<void>();

    // Chart configuration
    public authPieChartData: ChartConfiguration<'pie'>['data'] = {
        labels: [],
        datasets: [{ data: [], backgroundColor: [] }]
    };
    public authPieChartOptions: ChartOptions<'pie'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'right', labels: { padding: 20 } }
        }
    };

    private readonly CHART_TEXT_DARK = 'rgba(255, 255, 255, 0.8)';
    private readonly CHART_TEXT_LIGHT = 'rgba(0, 0, 0, 0.8)';

    constructor(private appThemeService: AppThemeService) { }

    ngOnInit(): void {
        // Handle search debounce
        this.searchSubject.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            takeUntil(this.destroy$)
        ).subscribe(term => {
            this.searchChange.emit(term);
        });

        // Handle theme changes for chart
        this.appThemeService.getAppTheme().pipe(takeUntil(this.destroy$)).subscribe(theme => {
            this.updateChartTheme(theme);
        });
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['userStats'] && this.userStats?.providers) {
            this.updateAuthChart(this.userStats.providers);
        }
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private updateAuthChart(providers: Record<string, number>): void {
        const providerLabels: Record<string, string> = {
            'google.com': 'Google',
            'password': 'Email/Password',
            'apple.com': 'Apple',
            'facebook.com': 'Facebook'
        };
        const providerColors: Record<string, string> = {
            'google.com': '#4285F4',
            'password': '#34A853',
            'apple.com': '#555555',
            'facebook.com': '#1877F2'
        };

        this.authPieChartData = {
            labels: Object.keys(providers).map(p => providerLabels[p] || p),
            datasets: [{
                data: Object.values(providers),
                backgroundColor: Object.keys(providers).map(p => providerColors[p] || '#9E9E9E')
            }]
        };
    }

    private updateChartTheme(theme: AppThemes): void {
        const isDark = theme === AppThemes.Dark;
        const textColor = isDark ? this.CHART_TEXT_DARK : this.CHART_TEXT_LIGHT;

        this.authPieChartOptions = {
            ...this.authPieChartOptions,
            plugins: {
                ...this.authPieChartOptions!.plugins,
                legend: {
                    ...this.authPieChartOptions!.plugins!.legend,
                    labels: {
                        ...((this.authPieChartOptions!.plugins!.legend as any)?.labels || {}),
                        color: textColor
                    }
                }
            }
        };
    }

    onPageChange(event: PageEvent): void {
        this.pageChange.emit(event);
    }

    onSortChange(sort: Sort): void {
        this.sortChange.emit(sort);
    }

    onSearchInput(event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.searchTerm = value;
        this.searchSubject.next(value);
    }

    clearSearch(): void {
        this.searchTerm = '';
        this.searchSubject.next('');
    }

    onImpersonate(user: AdminUser): void {
        this.impersonate.emit(user);
    }

    // Helper methods
    getRole(user: AdminUser): string {
        return user.customClaims?.stripeRole || 'free';
    }

    isAdmin(user: AdminUser): boolean {
        return user.customClaims?.admin === true;
    }

    getSubscriptionDetails(user: AdminUser): string {
        if (!user.subscription) return '-';

        let details = user.subscription.status.toUpperCase();

        if (user.subscription.cancel_at_period_end && user.subscription.current_period_end) {
            const date = this.formatDate(user.subscription.current_period_end);
            details += ` (Ends ${date})`;
        }

        return details;
    }

    private formatDate(timestamp: any): string {
        if (!timestamp) return '';
        const date = new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    formatConnectionDate(timestamp: any): string {
        if (!timestamp) return 'Time unknown';
        const date = new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    getServiceLogo(provider: string): string {
        switch (provider.toLowerCase()) {
            case 'garmin': return 'assets/logos/garmin.svg';
            case 'suunto': return 'assets/logos/suunto.svg';
            case 'coros': return 'assets/logos/coros.svg';
            default: return '';
        }
    }
}
