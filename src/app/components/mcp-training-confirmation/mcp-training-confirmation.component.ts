import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';

type ProposalStatus = 'pending' | 'applying' | 'applied' | 'partially_applied' | 'expired';

interface ProposalChange {
  index: number;
  kind: string;
  summary: string;
}

interface ProviderPreview {
  index: number;
  provider: 'garmin' | 'coros' | 'wahoo' | 'suunto';
  targetType: 'plan' | 'workout';
  action: 'enable' | 'send' | 'resume' | 'stop' | 'retry' | 'check' | 'approve';
  availability: 'ready' | 'unavailable' | 'reconnect_required' | 'connection_repair' | 'pro_required';
  timeZone: string | null;
  eligibleCount: number;
  warningCount: number;
  summary: string;
}

interface ProposalReview {
  schemaVersion: 1;
  status: ProposalStatus;
  expiresAtMs: number;
  permissionMode: 'schedule' | 'delivery' | 'combined';
  scheduleRevision: number;
  summary: string;
  changes: ProposalChange[];
  providerPreviews: ProviderPreview[];
}

interface AppliedChange {
  index: number;
  kind: string;
  status: 'applied' | 'already_applied' | 'failed';
  message: string;
}

interface AppliedProvider {
  index: number;
  provider: ProviderPreview['provider'];
  status: 'queued' | 'applied' | 'already_applied' | 'blocked' | 'failed';
  message: string;
}

interface ProposalResult {
  schemaVersion: 1;
  status: 'applied' | 'partially_applied';
  scheduleRevision: number;
  changes: AppliedChange[];
  providers: AppliedProvider[];
}

@Component({
  selector: 'app-mcp-training-confirmation',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CompactRowComponent,
  ],
  templateUrl: './mcp-training-confirmation.component.html',
  styleUrl: './mcp-training-confirmation.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpTrainingConfirmationComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly functions = inject(AppFunctionsService);
  private readonly haptics = inject(AppHapticsService);
  private readonly logger = inject(LoggerService);

  readonly loading = signal(true);
  readonly applying = signal(false);
  readonly review = signal<ProposalReview | null>(null);
  readonly result = signal<ProposalResult | null>(null);
  readonly error = signal<string | null>(null);
  private confirmationRef = '';

  ngOnInit(): void {
    this.confirmationRef = `${this.route.snapshot.paramMap.get('confirmationRef') || ''}`.trim();
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.functions.call<
        { confirmationRef: string },
        ProposalReview
      >('getMcpTrainingProposalReview', { confirmationRef: this.confirmationRef });
      this.review.set(response.data);
    } catch (error) {
      this.logger.error('[McpTrainingConfirmationComponent] Failed to load proposal review', error);
      this.error.set(this.reviewErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async apply(): Promise<void> {
    const review = this.review();
    if (this.applying() || review?.status !== 'pending') return;
    this.applying.set(true);
    this.error.set(null);
    this.haptics.selection();
    try {
      const response = await this.functions.call<
        { confirmationRef: string },
        ProposalResult
      >('applyMcpTrainingProposal', { confirmationRef: this.confirmationRef });
      this.result.set(response.data);
      this.review.update(value => value ? { ...value, status: response.data.status } : value);
      if (response.data.status === 'applied') {
        this.haptics.success();
      } else {
        this.haptics.warning();
      }
    } catch (error) {
      this.logger.error('[McpTrainingConfirmationComponent] Failed to apply proposal', error);
      this.error.set(this.applyErrorMessage(error));
      this.haptics.error();
    } finally {
      this.applying.set(false);
    }
  }

  leave(): void {
    this.haptics.selection();
    void this.router.navigateByUrl('/');
  }

  providerLabel(provider: ProviderPreview['provider']): string {
    return provider === 'garmin' ? 'Garmin Connect'
      : provider === 'coros' ? 'COROS'
        : provider === 'wahoo' ? 'Wahoo' : 'Suunto App';
  }

  private reviewErrorMessage(error: unknown): string {
    const code = `${(error as { code?: unknown } | null)?.code || ''}`;
    if (code.includes('unauthenticated')) return 'Sign in to the Quantified Self account that created this request.';
    if (code.includes('failed-precondition') || code.includes('invalid-argument')) {
      return 'This confirmation link is invalid, expired, or no longer authorized. Ask your connected client to prepare the change again.';
    }
    return 'The Training change could not be loaded. Try again.';
  }

  private applyErrorMessage(error: unknown): string {
    const code = `${(error as { code?: unknown } | null)?.code || ''}`;
    if (code.includes('failed-precondition') || code.includes('aborted')) {
      return 'The proposal, schedule, or permission changed. Nothing new was applied; ask your connected client to prepare a fresh preview.';
    }
    return 'The Training change could not be applied safely. Nothing should be retried automatically.';
  }
}
