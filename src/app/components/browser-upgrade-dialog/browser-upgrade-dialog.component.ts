import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { AppHapticsService } from '../../services/app.haptics.service';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-browser-upgrade-dialog',
    standalone: true,
    imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
    templateUrl: './browser-upgrade-dialog.component.html',
    styleUrls: ['./browser-upgrade-dialog.component.scss'],
})
export class BrowserUpgradeDialogComponent {
    readonly haptics = inject(AppHapticsService);
    constructor(public dialogRef: MatDialogRef<BrowserUpgradeDialogComponent>) { }
}
