import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, of } from 'rxjs';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { TrainingDeliveryService } from '../../services/training-delivery.service';
import { TrainingDeliveryDialogComponent } from './training-delivery-dialog.component';
import { TrainingDeliveryButtonComponent } from './training-delivery-button.component';

describe('Training provider delivery controls', () => {
  const user = signal<{ uid: string } | null>({ uid: 'owner' });
  const user$ = new BehaviorSubject<{ uid: string } | null>({ uid: 'owner' });
  let close: ReturnType<typeof vi.fn>;
  let service: { anyReady: boolean; isReady: ReturnType<typeof vi.fn>; watchPresence: ReturnType<typeof vi.fn>;
    watchScope: ReturnType<typeof vi.fn>; createMutationId: ReturnType<typeof vi.fn>; preview: ReturnType<typeof vi.fn>; mutate: ReturnType<typeof vi.fn> };
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  const status = { schemaVersion: 1, id: 'delivery', workoutId: 'w', planId: null, provider: 'garmin',
    status: 'needs_attention', differsFromQS: true, hasRemoteCopy: true, timeZone: 'Europe/Helsinki',
    approvalDigest: null, issues: [], updatedAtMs: 1,
    lastAttemptAtMs: Date.parse('2026-09-10T10:00:00Z'), lastAcceptedAtMs: null, retryCount: 1, nextRetryAtMs: null };
  beforeEach(async () => {
    user.set({ uid: 'owner' }); user$.next(user()); close = vi.fn();
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    service = { anyReady: false, isReady: vi.fn(() => false), watchPresence: vi.fn(() => of(true)),
      watchScope: vi.fn(() => of({ settings: [], statuses: [status] })), createMutationId: vi.fn(() => 'mutation'),
      preview: vi.fn(async () => ({ schemaVersion: 1, available: true, connection: 'connected', hasPro: true,
        timeZone: 'Europe/Helsinki', effect: 'enable', settingsRevision: 0, eligibleCount: 1, warningCount: 0, issues: [], approvalDigest: null })),
      mutate: vi.fn(async () => ({})) };
    await TestBed.configureTestingModule({ imports: [TrainingDeliveryDialogComponent, TrainingDeliveryButtonComponent], providers: [
      provideRouter([]), provideNoopAnimations(), { provide: AppUserService, useValue: { user, user$ } },
      { provide: AppHapticsService, useValue: haptics }, { provide: TrainingDeliveryService, useValue: service },
      { provide: MAT_DIALOG_DATA, useValue: { scope: 'workout', id: 'w', title: 'Morning run' } },
      { provide: MatDialogRef, useValue: { close } }, { provide: MatDialog, useValue: { open: vi.fn() } },
      { provide: TrainingPlansService, useValue: { watchSchedule: () => of({ state: { revision: 3 }, plans: [], workouts: [{
        schemaVersion: 1, id: 'w', planId: null, title: 'Morning run', revision: 2, localDate: '2026-09-10', lifecycle: 'planned',
        createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running, nodes: [] },
      }] }) } },
    ] }).compileComponents();
  });
  it('hides unavailable send controls but preserves problem details and Stop sync', () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Delivery uncertain'); expect(text).toContain('Stop sync');
    expect(text).not.toContain('Send workout'); expect(text).not.toContain('Configure sync');
    expect(text).toContain('Last attempt:'); expect(text).toContain('Failed attempts: 1');
    expect(haptics.selection).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled();
  });
  it('previews before consent and retries the exact mutation after an uncertain response', async () => {
    service.isReady.mockReturnValue(true);
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    component.begin('garmin', 'send'); component.updateTimeZone('Europe/Helsinki');
    expect(service.mutate).not.toHaveBeenCalled();
    await component.review();
    expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ expectedScheduleRevision: 3,
      expectedScopeRevision: 2, timeZone: 'Europe/Helsinki' }));
    service.mutate.mockRejectedValueOnce(new Error('uncertain'));
    await component.confirm(); expect(haptics.error).toHaveBeenCalledOnce();
    await component.confirm(); expect(haptics.success).toHaveBeenCalledOnce();
    expect(service.mutate.mock.calls[0][0]).toEqual(service.mutate.mock.calls[1][0]);
  });
  it('clears staged approval and records and closes when the account changes', async () => {
    const fixture = TestBed.createComponent(TrainingDeliveryDialogComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    component.begin('garmin', 'stop'); await component.review();
    user.set(null); user$.next(null); fixture.detectChanges();
    expect(component.preview()).toBeNull(); expect(component.view().statuses).toEqual([]); expect(close).toHaveBeenCalled();
    await component.confirm(); expect(service.mutate).not.toHaveBeenCalled();
  });
  it('does not expose a button when no provider is ready and no settings/status exist', () => {
    service.watchPresence.mockReturnValue(of(false));
    const fixture = TestBed.createComponent(TrainingDeliveryButtonComponent);
    fixture.componentRef.setInput('scope', 'plan'); fixture.componentRef.setInput('entityId', 'p'); fixture.componentRef.setInput('title', 'Plan');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
  it('renders the Material dialog shell and permits recovery without Pro without granting consent', async () => {
    TestBed.overrideProvider(MatDialog, { useFactory: () => new MatDialog() });
    service.isReady.mockImplementation(provider => provider === 'garmin');
    const ref = TestBed.inject(MatDialog).open(TrainingDeliveryDialogComponent, {
      data: { scope: 'workout', id: 'w', title: 'Morning run — September training' }, width: '640px', maxWidth: '95vw',
    });
    TestBed.inject(ApplicationRef).tick();
    await TestBed.inject(ApplicationRef).whenStable();
    // Vite's unit-test transform omits component SCSS. Compile those same source styles
    // only for the optional browser artifact, scoped to their real custom-element hosts.
    const qaCss = process.env.TRAINING_DELIVERY_QA_DIR ? [
      ['app-training-delivery-dialog', 'src/app/components/plans/training-delivery-dialog.component.scss'],
      ['app-compact-row', 'src/app/components/shared/compact-row/compact-row.component.scss'],
    ].map(([host, file]) => {
      const sass = createRequire(createRequire(import.meta.url).resolve('@angular/build/package.json'))('sass');
      return sass.compileString(`${host} { ${readFileSync(file, 'utf8').replace(/:host\(([^)]+)\)/g, '&$1').replace(/:host/g, '&')} }`).css;
    }).join('\n') : '';
    const render = (name: string) => {
      TestBed.inject(ApplicationRef).tick();
      ref.componentRef!.changeDetectorRef.detectChanges();
      // Optional synthetic DOM artifacts for desktop/mobile browser QA. No provider transport,
      // credentials, live data, or browser-selected production mode is involved.
      if (process.env.TRAINING_DELIVERY_QA_DIR) {
        const body = document.body.cloneNode(true) as HTMLElement;
        document.querySelectorAll('input').forEach((input, index) => body.querySelectorAll('input')[index].setAttribute('value', input.value));
        writeFileSync(join(process.env.TRAINING_DELIVERY_QA_DIR, `${name}.html`),
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Training delivery QA</title><link rel="stylesheet" href="styles.css">${Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('')}<style>${qaCss}</style></head><body>${body.innerHTML}</body></html>`);
      }
    };
    render('delivery-status');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.classList.contains('mdc-dialog--open')).toBe(true);
    expect(document.querySelector('h2')?.textContent).toContain('Provider delivery');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(document.querySelector('h2')?.id);
    ref.componentInstance.begin('garmin', 'send'); render('delivery-settings');
    await ref.componentInstance.review(); render('delivery-preview');
    ref.componentInstance.busy.set(true); render('delivery-pending'); ref.componentInstance.busy.set(false);
    ref.componentRef!.changeDetectorRef.detectChanges();
    Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Cancel')!.click();
    expect(ref.componentInstance.draft()).toBeNull();
    expect(ref.componentInstance.preview()).toBeNull();
    ref.componentInstance.begin('garmin', 'retry');
    service.preview.mockResolvedValue({ ...(await service.preview()), hasPro: false, effect: 'retry' });
    await ref.componentInstance.review(); render('delivery-retry');
    expect(ref.componentInstance.canConfirm()).toBe(true);
    expect(document.body.textContent).toContain('Retry does not resume stopped sync');
    await ref.componentInstance.confirm();
    expect(service.mutate).toHaveBeenCalledWith(expect.objectContaining({ action: 'retry' }));
    expect(service.mutate.mock.calls[0][0]).not.toHaveProperty('timeZone');
    ref.close();
  });
});
