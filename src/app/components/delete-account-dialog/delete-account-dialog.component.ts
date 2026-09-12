import { Component, Inject, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppUserService } from '../../services/app.user.service';
import { isTrainingPlanningUIAllowed } from '@shared/training-planning-rollout';

export interface DeleteAccountDialogData {
    displayName: string;
    hasActiveSubscription?: boolean;
}

@Component({
    selector: 'app-delete-account-dialog',
    standalone: true,
    imports: [
        CommonModule,
        MatDialogModule,
        MatButtonModule,
        MatIconModule,
        MatCheckboxModule,
        FormsModule
    ],
    templateUrl: './delete-account-dialog.component.html',
    styleUrls: ['./delete-account-dialog.component.scss']
})
export class DeleteAccountDialogComponent {
    confirmChecked = false;
    private readonly hapticsService = inject(AppHapticsService);
    private readonly users = inject(AppUserService);
    readonly hasTrainingPlanningUIAccess = computed(() => isTrainingPlanningUIAllowed(this.users.user()?.uid));

    constructor(
        public dialogRef: MatDialogRef<DeleteAccountDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: DeleteAccountDialogData
    ) { }

    onConfirm(): void {
        this.hapticsService.warning();
        this.dialogRef.close(true);
    }

    onCancel(): void {
        this.dialogRef.close(false);
    }
}
