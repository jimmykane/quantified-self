import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-payment-success',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule, RouterModule],
  templateUrl: './payment-success.component.html',
  styleUrls: ['./payment-success.component.scss']
})
export class PaymentSuccessComponent implements OnInit {
  private auth = inject(Auth);
  private logger = inject(LoggerService);
  isRefreshing = true;
  assignedRole: string | null = null;

  async ngOnInit(): Promise<void> {
    this.isRefreshing = true;
    const user = this.auth.currentUser;

    if (!user) {
      this.logger.error('PaymentSuccess: No current user found!');
      this.isRefreshing = false;
      return;
    }

    const maxAttempts = 10;
    let attempt = 0;
    let hasPremiumClaim = false;

    this.logger.log('PaymentSuccess: Starting claim polling...');

    while (!hasPremiumClaim && attempt < maxAttempts) {
      attempt++;
      try {
        this.logger.log(`PaymentSuccess: Polling attempt ${attempt}/${maxAttempts}...`);
        // Force refresh
        const tokenResult = await user.getIdTokenResult(true);
        const role = tokenResult.claims['stripeRole'] as string;

        this.logger.log('PaymentSuccess: Claims:', tokenResult.claims);

        if (role) {
          this.logger.log(`PaymentSuccess: Found stripeRole '${role}' on attempt ${attempt}!`);
          hasPremiumClaim = true;
          this.assignedRole = role;
        } else {
          this.logger.warn(`PaymentSuccess: stripeRole not found on attempt ${attempt}. Waiting...`);
          // Wait 2 seconds before next try
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        this.logger.error('PaymentSuccess: Error refreshing token:', error);
        // Wait even on error, so we don't spam
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!hasPremiumClaim) {
      this.logger.error('PaymentSuccess: Timeout waiting for stripeRole. User might need to re-login or wait longer.');
    }

    this.isRefreshing = false;
  }
}
