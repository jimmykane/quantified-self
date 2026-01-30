import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { AppWhatsNewService } from '../../services/app.whats-new.service';
import { AppUpdateService } from '../../services/app.update.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { WhatsNewFeedComponent } from './whats-new-feed.component';
import { Router } from '@angular/router';
import { computed } from '@angular/core';

@Component({
  selector: 'app-whats-new-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    WhatsNewFeedComponent,
    MatIconModule,
    MatDividerModule
  ],
  template: `
    <div mat-dialog-title class="dialog-header">
      <mat-icon class="header-icon">campaign</mat-icon>
      <span class="header-text">What's New</span>
    </div>
    <mat-divider></mat-divider>
    <mat-dialog-content class="dialog-content">
      @if (isUpdateAvailable()) {
        <div class="update-banner">
            <mat-icon>system_update</mat-icon>
            <div class="message">
                <strong>New version available</strong>
                <span>Reload to apply updates</span>
            </div>
            <button mat-flat-button color="primary" (click)="reload()">Reload</button>
        </div>
      }

      <div class="feed-wrapper">
        <app-whats-new-feed [limit]="1" [displayMode]="'full'"></app-whats-new-feed>
      </div>
    </mat-dialog-content>
    <mat-divider></mat-divider>
    <mat-dialog-actions align="end">
      <button mat-button *ngIf="!isReleasesPage()" (click)="navigateToReleases()">View All Updates</button>
      <button mat-raised-button color="primary" mat-dialog-close>Got it</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 24px !important;
      background: var(--mat-sys-surface-container-highest);
      
      .header-icon {
        color: var(--mat-sys-primary);
        font-size: 28px;
        width: 28px;
        height: 28px;
      }

      .header-text {
        font-size: 1.25rem;
        font-weight: 500;
        color: var(--mat-sys-on-surface);
      }
    }

    .dialog-content {
      min-width: 500px;
      max-width: 800px;
      padding: 20px 24px !important;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--mat-sys-surface);
      
      /* Avoid scrollbars clipping hover effects */
      overflow-x: hidden !important;
    }

    .feed-wrapper {
      padding: 4px; /* Space for hover transform */
    }

    .update-banner {
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
        border-radius: 12px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;

        mat-icon {
            color: var(--mat-sys-tertiary);
        }

        .message {
            flex: 1;
            display: flex;
            flex-direction: column;
            line-height: 1.2;

            strong {
                font-weight: 600;
            }
            
            span {
                font-size: 0.85em;
                opacity: 0.8;
            }
        }
    }

    @media (max-width: 600px) {
      .dialog-content {
        min-width: unset;
        width: 100%;
        padding: 16px !important;
      }
    }
  `]
})
export class WhatsNewDialogComponent implements OnInit {
  private whatsNewService = inject(AppWhatsNewService);
  private updateService = inject(AppUpdateService);
  private analyticsService = inject(AppAnalyticsService);
  private router = inject(Router);
  private dialogRef = inject(MatDialogRef<WhatsNewDialogComponent>);
  public isReleasesPage = computed(() => this.router.url.includes('/releases'));

  public isUpdateAvailable = this.updateService.isUpdateAvailable;

  ngOnInit() {
    this.analyticsService.logEvent('click_whats_new');
    // Mark as read when dialog is opened
    this.whatsNewService.markAsRead();
  }

  reload() {
    this.updateService.activateUpdate();
  }

  navigateToReleases() {
    this.router.navigate(['/releases']);
    this.dialogRef.close();
  }
}
