import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { AdminUserOverviewComponent } from '../admin-user-overview/admin-user-overview.component';
import { AdminUserTableComponent } from '../admin-user-table/admin-user-table.component';

@Component({
    selector: 'app-admin-user-workspace',
    standalone: true,
    imports: [
        MatButtonModule,
        MatIconModule,
        MatTabsModule,
        MatTooltipModule,
        RouterModule,
        PageHeaderComponent,
        AdminUserOverviewComponent,
        AdminUserTableComponent,
    ],
    templateUrl: './admin-user-workspace.component.html',
    styleUrls: ['./admin-user-workspace.component.scss'],
})
export class AdminUserWorkspaceComponent implements OnInit, OnDestroy {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly destroy$ = new Subject<void>();

    readonly selectedTabIndex = signal(0);

    ngOnInit(): void {
        this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
            this.selectedTabIndex.set(params.get('tab') === 'users' ? 1 : 0);
        });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    selectTab(index: number): void {
        const normalizedIndex = index === 1 ? 1 : 0;
        this.selectedTabIndex.set(normalizedIndex);
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tab: normalizedIndex === 1 ? 'users' : 'overview' },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }
}
