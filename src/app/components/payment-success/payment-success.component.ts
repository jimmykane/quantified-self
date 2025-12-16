import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterModule } from '@angular/router';

@Component({
    selector: 'app-payment-success',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, RouterModule],
    template: `
    <div class="container">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Payment Successful!</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <p>Thank you for your purchase. Your subscription is now active.</p>
        </mat-card-content>
        <mat-card-actions>
          <button mat-raised-button color="primary" routerLink="/dashboard">Go to Dashboard</button>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
    styles: [`
    .container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 80vh;
    }
    mat-card {
      max-width: 400px;
      text-align: center;
      padding: 20px;
    }
    mat-card-actions {
        justify-content: center;
    }
  `]
})
export class PaymentSuccessComponent {
    constructor() { }
}
