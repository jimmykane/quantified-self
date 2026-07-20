import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatIconRegistry } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { describe, expect, it, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { ServiceConnectionStatusComponent } from './service-connection-status.component';

describe('ServiceConnectionStatusComponent', () => {
    let component: ServiceConnectionStatusComponent;
    let fixture: ComponentFixture<ServiceConnectionStatusComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [ServiceConnectionStatusComponent],
            imports: [
                MatChipsModule,
                MatDividerModule,
                MatIconModule,
                MatProgressBarModule,
            ],
            providers: [
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
