import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { AdminUserKpiCard } from '../../../helpers/admin-user-kpis.helper';
import { CompactCountPipe } from '../../../helpers/compact-count.pipe';

@Component({
    selector: 'app-admin-user-kpi-grid',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatCardModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        CompactCountPipe,
    ],
    templateUrl: './admin-user-kpi-grid.component.html',
    styleUrls: ['./admin-user-kpi-grid.component.scss'],
})
export class AdminUserKpiGridComponent {
    @Input() cards: readonly AdminUserKpiCard[] = [];
    @Input() loading = false;
    @Input() error: string | null = null;
    @Input() showCountRefreshActions = false;
    @Input() actionsDisabled = false;
    @Input() refreshingEventCount = false;
    @Input() refreshingRouteCount = false;

    @Output() readonly refreshEventCount = new EventEmitter<void>();
    @Output() readonly refreshRouteCount = new EventEmitter<void>();
}
