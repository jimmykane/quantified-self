import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { describe, expect, it, beforeEach } from 'vitest';
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

        expect(text).toContain('Garmin connection');
        expect(text).toContain('Not connected');
        expect(text).toContain('Required for history imports and auto-sync.');
        expect(fixture.nativeElement.querySelector('mat-card')).toBeFalsy();
        expect(fixture.nativeElement.querySelector('.service-connection-status--connected')).toBeFalsy();
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
});
