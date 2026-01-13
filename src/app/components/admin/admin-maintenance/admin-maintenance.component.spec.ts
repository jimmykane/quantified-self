import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminMaintenanceComponent } from './admin-maintenance.component';
import { AdminService } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('AdminMaintenanceComponent', () => {
    let component: AdminMaintenanceComponent;
    let fixture: ComponentFixture<AdminMaintenanceComponent>;
    let adminServiceSpy: any;
    let loggerSpy: any;
    let matDialogSpy: any;

    const mockMaintenanceStatus = {
        prod: { enabled: false, message: 'Prod Message' },
        beta: { enabled: true, message: 'Beta Message' },
        dev: { enabled: false, message: 'Dev Message' }
    };

    beforeEach(async () => {
        adminServiceSpy = {
            getMaintenanceStatus: vi.fn().mockReturnValue(of(mockMaintenanceStatus)),
            setMaintenanceMode: vi.fn().mockImplementation((enabled, message, env) => of({
                success: true,
                enabled,
                message,
                env
            }))
        };

        loggerSpy = {
            error: vi.fn(),
            log: vi.fn()
        };

        matDialogSpy = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(true)
            })
        };

        await TestBed.configureTestingModule({
            imports: [AdminMaintenanceComponent, NoopAnimationsModule],
            providers: [
                { provide: AdminService, useValue: adminServiceSpy },
                { provide: LoggerService, useValue: loggerSpy },
                // MatDialog is provided via overrideProvider to ensure precedence over Component's imports
            ]
        })
            .overrideProvider(MatDialog, { useValue: matDialogSpy })
            .compileComponents();

        fixture = TestBed.createComponent(AdminMaintenanceComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should fetch maintenance status on init', () => {
        expect(adminServiceSpy.getMaintenanceStatus).toHaveBeenCalled();
        expect(component.prodMaintenance.message).toBe('Prod Message');
        expect(component.betaMaintenance.enabled).toBe(true);
    });

    it('should detect message changes', () => {
        component.prodMaintenance.message = 'New Prod Message';
        expect(component.hasMessageChanged('prod')).toBe(true);

        component.prodMaintenance.message = 'Prod Message'; // Revert
        expect(component.hasMessageChanged('prod')).toBe(false);
    });

    it('should save maintenance message', () => {
        component.prodMaintenance.message = 'Updated Prod';
        component.saveMaintenanceMessage('prod');

        expect(adminServiceSpy.setMaintenanceMode).toHaveBeenCalledWith(false, 'Updated Prod', 'prod');
        expect(component.prodMaintenance.originalMessage).toBe('Updated Prod');
        expect(component.isUpdatingMaintenance).toBe(false);
    });

    it('should handle toggle maintenance with confirmation', () => {
        const toggleEvent = { checked: true, source: { checked: true } } as any;
        component.onMaintenanceToggle(toggleEvent, 'prod');

        expect(matDialogSpy.open).toHaveBeenCalled();
        expect(adminServiceSpy.setMaintenanceMode).toHaveBeenCalledWith(true, 'Prod Message', 'prod');
        expect(component.prodMaintenance.enabled).toBe(true);
    });

    it('should cancel toggle if dialog is rejected', () => {
        matDialogSpy.open.mockReturnValue({
            afterClosed: () => of(false)
        });

        const toggleEvent = { checked: true, source: { checked: true } } as any;
        component.onMaintenanceToggle(toggleEvent, 'prod');

        expect(matDialogSpy.open).toHaveBeenCalled();
        expect(adminServiceSpy.setMaintenanceMode).not.toHaveBeenCalled();
        // Check UI reversion (source.checked should be flipped back)
        expect(toggleEvent.source.checked).toBe(false);
    });

    it('should handle error when saving message', () => {
        adminServiceSpy.setMaintenanceMode.mockReturnValue(throwError(() => new Error('Save failed')));

        component.prodMaintenance.message = 'Fail Update';
        component.saveMaintenanceMessage('prod');

        expect(loggerSpy.error).toHaveBeenCalled();
        expect(component.isUpdatingMaintenance).toBe(false);
    });
});
