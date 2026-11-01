import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatIconRegistry } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import { ServiceConnectionStatusComponent } from './service-connection-status.component';
import { signal } from '@angular/core';
import { AppUserService } from '../../../services/app.user.service';
import { SharedModule } from '../../../modules/shared.module';
import { provideRouter, Router } from '@angular/router';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppEventService } from '../../../services/app.event.service';

describe('ServiceConnectionStatusComponent', () => {
    let component: ServiceConnectionStatusComponent;
    let fixture: ComponentFixture<ServiceConnectionStatusComponent>;
    const viewer = signal<{ uid: string; stripeRole?: string } | null>(null);
    const haptics = { selection: vi.fn() };

    beforeEach(async () => {
        viewer.set({ uid: 'planning-user' });
        haptics.selection.mockClear();
        await TestBed.configureTestingModule({
            declarations: [ServiceConnectionStatusComponent],
            imports: [
                MatChipsModule,
                MatDividerModule,
                MatIconModule,
                MatProgressBarModule,
                SharedModule,
            ],
            providers: [
                provideRouter([]),
                { provide: AppHapticsService, useValue: haptics },
                { provide: AppUserService, useValue: { user: viewer } },
                { provide: AppEventService, useValue: {} },
                {
                    provide: MatIconRegistry,
                    useValue: {
                        getDefaultFontSetClass: () => ['material-icons'],
                        getNamedSvgIcon: () => {
                            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                            return of(svg);
                        },
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ServiceConnectionStatusComponent);
        component = fixture.componentInstance;
    });

    it('renders a compact disconnected status', () => {
        component.serviceLabel = 'Garmin';
        component.description = 'Required for history imports and auto-sync.';
        component.connected = false;
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent;

        expect(text).toContain('Garmin');
        expect(text).toContain('Not connected');
        expect(text).toContain('Required for history imports and auto-sync.');
        expect(fixture.nativeElement.querySelector('mat-card')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('.service-connection-status--connected')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('.service-connection-status__state')).toBeTruthy();
    });

    it('describes automatic imports only for a healthy connection with the feature enabled', () => {
        component.automaticImports = true; component.connected = true; component.providerIcon = 'suunto';
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('New activities import automatically.');
        for (const state of [
            { automaticImports: false, connected: true, loading: false, statusTone: 'default', statusLabelOverride: null },
            { automaticImports: true, connected: false, loading: false, statusTone: 'default', statusLabelOverride: null },
            { automaticImports: true, connected: true, loading: true, statusTone: 'default', statusLabelOverride: null },
            { automaticImports: true, connected: true, loading: false, statusTone: 'attention', statusLabelOverride: 'Reconnect required' },
        ] as const) {
            Object.assign(component, state); fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('.service-connection-status__automatic-imports')).toBeNull();
        }
        component.automaticImports = true; component.connected = true; component.loading = false;
        component.statusTone = 'default'; component.statusLabelOverride = null; component.providerIcon = 'wahoo';
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Eligible Wahoo workouts import automatically.');
    });

    it('renders connected and Pro states without a card surface', () => {
        component.serviceLabel = 'Suunto App';
        component.connected = true;
        component.proRequired = true;
        component.loading = true;
        component.showDetails = true;
        fixture.detectChanges();

        const status = fixture.nativeElement.querySelector('.service-connection-status');

        expect(status.classList.contains('service-connection-status--connected')).toBe(true);
        expect(fixture.nativeElement.querySelector('mat-card')).toBeFalsy();
        expect(fixture.nativeElement.textContent).toContain('Connected');
        expect(fixture.nativeElement.textContent).toContain('PRO');
        expect(fixture.nativeElement.querySelector('mat-progress-bar')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('mat-divider')).toBeTruthy();
    });

    it('renders the supplied provider logo next to the connection state', () => {
        component.serviceLabel = 'Wahoo';
        component.providerIcon = 'wahoo';
        fixture.detectChanges();

        const providerIcon = fixture.nativeElement.querySelector('.service-connection-status__provider-icon');

        expect(providerIcon).toBeTruthy();
    });

    function renderOffer(trialDays: number | null = 30, priceId: string | null = 'price_pro_month') {
        component.serviceLabel = 'Garmin Connect';
        component.providerIcon = 'garmin';
        component.proRequired = true;
        fixture.componentRef.setInput('proOffer', { priceId, trialDays });
        fixture.detectChanges();
    }

    it('shows the configured trial and an exact-price review link without starting checkout', () => {
        renderOffer(14, 'price_pro_year');
        const link = fixture.nativeElement.querySelector('.membership-offer__actions a');
        expect(link.textContent).toContain('Try Pro free for 14 days');
        expect(link.getAttribute('href')).toBe('/subscriptions?priceId=price_pro_year');
        expect(fixture.nativeElement.textContent).toContain('Review billing terms before you start');
        expect(fixture.nativeElement.textContent).toContain('Payment method required.');
        expect(fixture.nativeElement.textContent).not.toContain('No card needed');
        expect(haptics.selection).not.toHaveBeenCalled();
    });

    it('uses Get Pro without a trial claim when eligibility is unknown', () => {
        renderOffer(null, null);
        const link = fixture.nativeElement.querySelector('.membership-offer__actions a');
        expect(link.textContent).toContain('Get Pro');
        expect(link.getAttribute('href')).toBe('/subscriptions');
        expect(fixture.nativeElement.textContent).not.toContain('free for');
        expect(fixture.nativeElement.textContent).not.toContain('No card needed');
    });

    it('leaves Starter available and gives one selection haptic for navigation', () => {
        const router = TestBed.inject(Router);
        const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        renderOffer();
        expect(fixture.nativeElement.textContent).toContain('Manual file uploads and analysis stay available with Starter');
        const links = fixture.nativeElement.querySelectorAll('.membership-offer__actions a');
        links[0].click();
        expect(haptics.selection).toHaveBeenCalledTimes(1);
        expect(router.serializeUrl(navigate.mock.calls[0][0] as import('@angular/router').UrlTree)).toBe('/subscriptions?priceId=price_pro_month');
        links[1].click();
        expect(haptics.selection).toHaveBeenCalledTimes(2);
        expect(links[1].getAttribute('href')).toBe('/dashboard');
    });

    it.each(['connected', 'loading', 'showDetails', 'statusLabelOverride', 'attention'])('keeps %s connection controls instead of replacing them with an offer', state => {
        if (state === 'connected') component.connected = true;
        if (state === 'loading') component.loading = true;
        if (state === 'showDetails') component.showDetails = true;
        if (state === 'statusLabelOverride') component.statusLabelOverride = 'Reconnect required';
        if (state === 'attention') component.statusTone = 'attention';
        renderOffer();
        expect(fixture.nativeElement.querySelector('.membership-offer')).toBeNull();
        expect(fixture.nativeElement.querySelector('.service-connection-status__summary')).toBeTruthy();
    });

    it('limits the Wahoo promise to Wahoo-recorded FIT-backed activities', () => {
        renderOffer();
        component.providerIcon = 'wahoo';
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Wahoo-recorded');
        expect(fixture.nativeElement.textContent).toContain('Eligible FIT-backed Wahoo workouts');
    });

    it('keeps the existing Basic membership without calling it Starter', () => {
        viewer.set({uid:'planning-user', stripeRole:'basic'});
        renderOffer(null);
        expect(fixture.nativeElement.querySelector('.membership-offer__actions a:last-child').textContent).toContain('Keep current plan');
    });
    it('explains planned-workout consent and retained copies before disconnecting', () => {
        component.providerIcon = 'garmin'; component.connected = true;
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Disconnecting ends any planned-workout sync opt-in');
        expect(fixture.nativeElement.textContent).toContain('Use Stop sync in Training plans before disconnecting');
        component.connected = false; fixture.detectChanges();
        expect(fixture.nativeElement.textContent).not.toContain('Disconnecting ends any planned-workout sync opt-in');
    });

    it('keeps planning instructions visible for a signed-in user outside the former rollout', () => {
        component.providerIcon = 'garmin'; component.connected = true;
        fixture.detectChanges();
        viewer.set({ uid: 'another-user' }); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Training plans');
        expect(fixture.nativeElement.textContent).toContain('Stop sync');
        expect(fixture.nativeElement.textContent).toContain('Connected');
        expect(fixture.nativeElement.textContent).toContain('leaves provider copies');
    });

    it('uses the app success green for connected status text', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/service-connection-status/service-connection-status.component.scss'),
            'utf8'
        );
        const connectedStateRule = styles.match(
            /\.service-connection-status--connected \.service-connection-status__state\s*\{[^}]*\}/
        )?.[0] ?? '';

        expect(connectedStateRule).toContain('color: var(--qs-theme-success)');
    });

    it('uses the Connectivity surface border token', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/service-connection-status/service-connection-status.component.scss'),
            'utf8'
        );
        const contentRule = styles.match(/\.service-connection-status__content\s*\{[^}]*\}/)?.[0] ?? '';

        expect(contentRule).toContain('border: 1px solid var(--services-surface-border, var(--mat-sys-outline-variant))');
    });

    it('does not make status layout wrappers nested scroll containers', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/services/service-connection-status/service-connection-status.component.scss'),
            'utf8'
        );
        const wrappers = [
            '.service-connection-status__content',
            '.service-connection-status__details',
        ];

        for (const wrapper of wrappers) {
            const escapedWrapper = wrapper.replace('.', '\\.');
            const rule = styles.match(new RegExp(`${escapedWrapper}\\s*\\{[^}]*\\}`))?.[0] ?? '';

            expect(rule).not.toContain('overflow-x');
            expect(rule).not.toContain('overflow-y');
            expect(rule).not.toContain('overflow: auto');
        }
    });
});
