import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { RouterModule } from '@angular/router';

@Component({
    selector: 'app-payment-cancel',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, RouterModule],
    template: `
    <div class="container">
      <mat-card class="cancel-card">
        <mat-card-header>
          <mat-card-title>Payment Canceled</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <p>You have canceled the payment process. No charges were made.</p>
        </mat-card-content>
        <mat-card-actions class="action-row">
          <button mat-button routerLink="/dashboard">Back to Dashboard</button>
          <button mat-flat-button class="qs-mat-warn" routerLink="/subscriptions">Try Again</button>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
    styles: [`
    .container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 80vh;
      padding: 20px;
    }
    .cancel-card {
      max-width: 420px;
      width: 100%;
      text-align: center;
      padding: 20px;
    }

    .action-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin: 0;
      padding-top: 12px;
    }

    .action-row button {
      flex: 1 1 0;
    }

    @media (max-width: 480px) {
      .action-row {
        flex-direction: column;
      }

      .action-row button {
        width: 100%;
      }
    }
  `]
})
export class PaymentCancelComponent {
    constructor() { }
}
