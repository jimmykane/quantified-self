import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { FinancialStats } from '../../../services/admin.service';

@Component({
    selector: 'app-admin-financials',
    templateUrl: './admin-financials.component.html',
    styleUrls: ['./admin-financials.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatButtonModule
    ]
})
export class AdminFinancialsComponent {
    @Input() stats: FinancialStats | null = null;
    @Input() loading = false;

    formatCurrency(amountCents: number, currency: string): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency.toUpperCase()
        }).format(amountCents / 100);
    }

    openExternalLink(url: string | null | undefined): void {
        if (url) {
            window.open(url, '_blank');
        }
    }
}
