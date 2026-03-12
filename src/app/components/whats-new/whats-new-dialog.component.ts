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
  styleUrl: './whats-new-dialog.component.scss',
  template: `
    <div mat-dialog-title class="dialog-header">
      <mat-icon class="header-icon">campaign</mat-icon>
      <span class="header-text">What's New</span>
    </div>
    <mat-dialog-content class="dialog-content qs-scrollbar">
      <div class="dialog-body">
        @if (isUpdateAvailable()) {
          <div class="update-banner">
              <mat-icon>system_update</mat-icon>
              <div class="message">
                  <strong>New version available</strong>
                  <span>Reload to apply updates</span>
              </div>
              <button mat-flat-button class="qs-mat-primary" (click)="reload()">Reload</button>
          </div>
        }

        <div class="feed-wrapper">
          <app-whats-new-feed [limit]="1" [displayMode]="'full'"></app-whats-new-feed>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button *ngIf="!isReleasesPage()" (click)="navigateToReleases()">View All Updates</button>
      <button mat-raised-button class="qs-mat-primary" mat-dialog-close>Got it</button>
    </mat-dialog-actions>
  `
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
