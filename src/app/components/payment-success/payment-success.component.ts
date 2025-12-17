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
      <mat-card class="success-card">
        <mat-card-header>
          <mat-card-title>Payment Successful!</mat-card-title>
        </mat-card-header>
        
        <mat-card-content>
          <div class="content-wrapper">
            @if (isRefreshing) {
              <div class="loader-container">
                <mat-spinner diameter="60"></mat-spinner>
                <p>Activating your subscription...</p>
              </div>
            } @else {
              <div class="checkmark-wrapper">
                <svg class="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                  <circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
                  <path class="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                </svg>
              </div>
              
              <h2 class="welcome-text">Welcome to Premium!</h2>
              <p class="description">
                Thank you for your purchase. Your subscription is now active. 
                You now have full access to all premium features and performance analytics.
              </p>
            }
          </div>
        </mat-card-content>
        
        <mat-card-actions>
          <button mat-flat-button color="primary" routerLink="/dashboard" [disabled]="isRefreshing">
            Go to Dashboard
          </button>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      width: 100%;
    }

    .container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100%;
      padding: 20px;
    }

    .success-card {
      max-width: 450px;
      width: 100%;
      text-align: center;
      padding: 24px;
    }

    mat-card-header {
      justify-content: center;
      margin-bottom: 16px;
    }

    .content-wrapper {
      padding: 16px 0;
    }

    .loader-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    /* Simple Checkmark Animation */
    .checkmark-wrapper {
      width: 60px;
      height: 60px;
      margin: 0 auto 20px;
    }

    .checkmark {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      display: block;
      stroke-width: 3;
      stroke: #4caf50;
      stroke-miterlimit: 10;
      animation: fill .4s ease-in-out .4s forwards;
    }

    .checkmark__circle {
      stroke-dasharray: 166;
      stroke-dashoffset: 166;
      stroke-width: 3;
      stroke-miterlimit: 10;
      stroke: #4caf50;
      fill: none;
      animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
    }

    .checkmark__check {
      transform-origin: 50% 50%;
      stroke-dasharray: 48;
      stroke-dashoffset: 48;
      animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards;
    }

    @keyframes stroke {
      100% { stroke-dashoffset: 0; }
    }

    @keyframes fill {
      100% { box-shadow: inset 0px 0px 0px 30px rgba(76, 175, 80, 0.1); }
    }

    .welcome-text {
      margin: 0 0 12px;
      font-weight: 500;
    }

    .description {
      color: rgba(0, 0, 0, 0.6);
      line-height: 1.5;
      margin-bottom: 24px;
    }

    mat-card-actions {
      justify-content: center;
    }

    button {
      padding: 0 32px !important;
      height: 44px !important;
      border-radius: 22px !important;
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
