import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { AdminService } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';

@Component({
    selector: 'app-admin-maintenance',
    templateUrl: './admin-maintenance.component.html',
    styleUrls: ['./admin-maintenance.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatExpansionModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatProgressSpinnerModule,
        MatSlideToggleModule,
        MatDialogModule
    ]
})
export class AdminMaintenanceComponent implements OnInit, OnDestroy {
    // Maintenance mode
    prodMaintenance = { enabled: false, message: '', originalMessage: '' };
    betaMaintenance = { enabled: false, message: '', originalMessage: '' };
    devMaintenance = { enabled: false, message: '', originalMessage: '' };
    isUpdatingMaintenance = false;

    private destroy$ = new Subject<void>();

    constructor(
        private adminService: AdminService,
        private logger: LoggerService,
        private dialog: MatDialog
    ) { }

    ngOnInit(): void {
        this.fetchMaintenanceStatus();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    fetchMaintenanceStatus(): void {
        this.adminService.getMaintenanceStatus().pipe(takeUntil(this.destroy$)).subscribe({
            next: (status) => {
                this.prodMaintenance = {
                    enabled: status.prod.enabled,
                    message: status.prod.message || "",
                    originalMessage: status.prod.message || ""
                };
                this.betaMaintenance = {
                    enabled: status.beta.enabled,
                    message: status.beta.message || "",
                    originalMessage: status.beta.message || ""
                };
                this.devMaintenance = {
                    enabled: status.dev.enabled,
                    message: status.dev.message || "",
                    originalMessage: status.dev.message || ""
                };
            },
            error: (err) => {
                this.logger.error('Failed to fetch maintenance status:', err);
            }
        });
    }

    hasMessageChanged(env: 'prod' | 'beta' | 'dev'): boolean {
        const m = env === 'prod' ? this.prodMaintenance : (env === 'beta' ? this.betaMaintenance : this.devMaintenance);
        return m.message !== m.originalMessage;
    }

    saveMaintenanceMessage(env: 'prod' | 'beta' | 'dev'): void {
        if (!this.hasMessageChanged(env)) return;

        const m = env === 'prod' ? this.prodMaintenance : (env === 'beta' ? this.betaMaintenance : this.devMaintenance);
        this.isUpdatingMaintenance = true;
        this.adminService.setMaintenanceMode(m.enabled, m.message, env).subscribe({
            next: (result) => {
                const updated = {
                    enabled: result.enabled,
                    message: result.message,
                    originalMessage: result.message
                };
                if (env === 'prod') this.prodMaintenance = updated;
                else if (env === 'beta') this.betaMaintenance = updated;
                else this.devMaintenance = updated;
                this.isUpdatingMaintenance = false;
            },
            error: (err) => {
                this.logger.error(`Failed to save ${env} maintenance message:`, err);
                this.isUpdatingMaintenance = false;
            }
        });
    }

    onMaintenanceToggle(event: MatSlideToggleChange, env: 'prod' | 'beta' | 'dev'): void {
        const isEnable = event.checked;
        const envLabels = { prod: 'PRODUCTION', beta: 'BETA', dev: 'DEV' };
        const envLabel = envLabels[env];
        const confirmMessage = isEnable
            ? `Are you sure you want to ENABLE maintenance mode for ${envLabel}? This will prevent all non-admin users in that environment from accessing the app.`
            : `Are you sure you want to DISABLE maintenance mode for ${envLabel}? All users in that environment will regain access immediately.`;

        const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
            width: '400px',
            data: {
                title: isEnable ? `Enable ${envLabel} Maintenance?` : `Disable ${envLabel} Maintenance?`,
                message: confirmMessage,
                confirmText: isEnable ? 'Enable' : 'Disable',
                cancelText: 'Cancel'
            }
        });

        dialogRef.afterClosed().subscribe(result => {
            if (!result) {
                // Revert the toggle UI if cancelled
                event.source.checked = !isEnable;
                if (env === 'prod') this.prodMaintenance.enabled = !isEnable;
                else if (env === 'beta') this.betaMaintenance.enabled = !isEnable;
                else this.devMaintenance.enabled = !isEnable;
                return;
            }

            this.isUpdatingMaintenance = true;
            const m = env === 'prod' ? this.prodMaintenance : (env === 'beta' ? this.betaMaintenance : this.devMaintenance);

            this.adminService.setMaintenanceMode(isEnable, m.message, env).subscribe({
                next: (result) => {
                    const updated = {
                        enabled: result.enabled,
                        message: result.message,
                        originalMessage: result.message
                    };
                    if (env === 'prod') this.prodMaintenance = updated;
                    else if (env === 'beta') this.betaMaintenance = updated;
                    else this.devMaintenance = updated;
                    this.isUpdatingMaintenance = false;
                    this.logger.log(`Maintenance mode [${env}] ${result.enabled ? 'ENABLED' : 'DISABLED'}`);
                },
                error: (err) => {
                    this.logger.error(`Failed to update ${env} maintenance mode:`, err);
                    this.isUpdatingMaintenance = false;
                    // Revert the toggle
                    if (env === 'prod') this.prodMaintenance.enabled = !isEnable;
                    else if (env === 'beta') this.betaMaintenance.enabled = !isEnable;
                    else this.devMaintenance.enabled = !isEnable;
                    event.source.checked = !isEnable;
                }
            });
        });
    }
}
