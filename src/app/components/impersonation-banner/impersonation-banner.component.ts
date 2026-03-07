import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppImpersonationService } from '../../services/app.impersonation.service';

@Component({
    selector: 'app-impersonation-banner',
    standalone: true,
    imports: [CommonModule, MatButtonModule, MatIconModule],
    templateUrl: './impersonation-banner.component.html',
    styleUrls: ['./impersonation-banner.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImpersonationBannerComponent {
    protected impersonationService = inject(AppImpersonationService);

    protected onReturnToAdmin(): void {
        void this.impersonationService.returnToAdmin().catch(() => undefined);
    }
}
