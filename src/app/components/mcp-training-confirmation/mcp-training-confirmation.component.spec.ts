import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';
import { McpTrainingConfirmationComponent } from './mcp-training-confirmation.component';

describe('McpTrainingConfirmationComponent', () => {
  it('reviews and applies the exact opaque proposal only after the user clicks confirm', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ data: {
        schemaVersion: 1,
        status: 'pending',
        expiresAtMs: Date.now() + 60_000,
        permissionMode: 'combined',
        scheduleRevision: 4,
        summary: 'Two proposed Training changes will be applied in order after confirmation.',
        changes: [
          { index: 0, kind: 'create-workout', summary: 'Create “Easy run” on 2026-09-20 as a standalone workout.' },
          { index: 1, kind: 'provider-delivery', summary: 'Send the workout.' },
        ],
        providerPreviews: [{
          index: 1,
          provider: 'garmin',
          targetType: 'workout',
          action: 'send',
          availability: 'ready',
          timeZone: 'Europe/Helsinki',
          eligibleCount: 1,
          warningCount: 0,
          summary: 'garmin: enable ongoing workout delivery; 1 currently eligible, 0 with mapping warnings.',
        }],
      } })
      .mockResolvedValueOnce({ data: {
        schemaVersion: 1,
        status: 'applied',
        scheduleRevision: 5,
        changes: [{ index: 0, kind: 'create-workout', status: 'applied', message: 'Created the workout.' }],
        providers: [{ index: 1, provider: 'garmin', status: 'applied', message: 'Delivery was queued.' }],
      } });
    const success = vi.fn();
    await TestBed.configureTestingModule({
      imports: [McpTrainingConfirmationComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: {
          snapshot: { paramMap: { get: (name: string) => name === 'confirmationRef' ? 'opaque-ref' : null } },
        } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: AppFunctionsService, useValue: { call } },
        { provide: AppHapticsService, useValue: {
          selection: vi.fn(), success, warning: vi.fn(), error: vi.fn(),
        } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(McpTrainingConfirmationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(call).toHaveBeenCalledWith('getMcpTrainingProposalReview', { confirmationRef: 'opaque-ref' });
    expect(fixture.nativeElement.textContent).toContain('Create “Easy run”');
    expect(fixture.nativeElement.textContent).toContain('Garmin Connect');
    expect(call).toHaveBeenCalledTimes(1);

    (fixture.nativeElement.querySelector('button[mat-flat-button]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(call).toHaveBeenNthCalledWith(2, 'applyMcpTrainingProposal', { confirmationRef: 'opaque-ref' });
    expect(fixture.nativeElement.textContent).toContain('Changes applied');
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('does not offer confirmation for an expired proposal', async () => {
    const call = vi.fn().mockResolvedValue({ data: {
      schemaVersion: 1,
      status: 'expired',
      expiresAtMs: Date.now() - 1,
      permissionMode: 'schedule',
      scheduleRevision: 4,
      summary: 'One proposed change.',
      changes: [{ index: 0, kind: 'create-workout', summary: 'Create the workout.' }],
      providerPreviews: [],
    } });
    await TestBed.configureTestingModule({
      imports: [McpTrainingConfirmationComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: {
          snapshot: { paramMap: { get: () => 'opaque-ref' } },
        } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: AppFunctionsService, useValue: { call } },
        { provide: AppHapticsService, useValue: {
          selection: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
        } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(McpTrainingConfirmationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('This preview expired');
    expect(fixture.nativeElement.querySelector('button[mat-flat-button]')).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });
});
