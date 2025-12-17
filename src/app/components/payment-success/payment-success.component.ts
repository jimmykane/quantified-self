import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';

@Component({
  selector: 'app-payment-success',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule, RouterModule],
  template: `
    <div class="container">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Payment Successful!</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (isRefreshing) {
            <p>Activating your subscription...</p>
            <mat-spinner diameter="40"></mat-spinner>
          } @else {
            <p>Thank you for your purchase. Your subscription is now active.</p>
          }
        </mat-card-content>
        <mat-card-actions>
          <button mat-raised-button color="primary" routerLink="/dashboard" [disabled]="isRefreshing">
            Go to Dashboard
          </button>
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
    mat-spinner {
        margin: 20px auto;
    }
  `]
})
export class PaymentSuccessComponent implements OnInit {
  private auth = inject(Auth);
  isRefreshing = true;

  async ngOnInit(): Promise<void> {
    this.isRefreshing = true;
    const user = this.auth.currentUser;

    if (!user) {
      console.error('PaymentSuccess: No current user found!');
      this.isRefreshing = false;
      return;
    }

    const maxAttempts = 10;
    let attempt = 0;
    let hasPremiumClaim = false;

    console.log('PaymentSuccess: Starting claim polling...');

    while (!hasPremiumClaim && attempt < maxAttempts) {
      attempt++;
      try {
        console.log(`PaymentSuccess: Polling attempt ${attempt}/${maxAttempts}...`);
        // Force refresh
        const tokenResult = await user.getIdTokenResult(true);
        const role = tokenResult.claims['stripeRole'];

        console.log('PaymentSuccess: Claims:', tokenResult.claims);

        if (role) {
          console.log(`PaymentSuccess: Found stripeRole '${role}' on attempt ${attempt}!`);
          hasPremiumClaim = true;
        } else {
          console.warn(`PaymentSuccess: stripeRole not found on attempt ${attempt}. Waiting...`);
          // Wait 2 seconds before next try
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error('PaymentSuccess: Error refreshing token:', error);
        // Wait even on error, so we don't spam
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!hasPremiumClaim) {
      console.error('PaymentSuccess: Timeout waiting for stripeRole. User might need to re-login or wait longer.');
    }

    this.isRefreshing = false;
  }
}
