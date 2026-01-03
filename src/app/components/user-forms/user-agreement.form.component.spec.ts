import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserAgreementFormComponent } from './user-agreement.form.component';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { LoggerService } from '../../services/logger.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { User, Privacy } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('UserAgreementFormComponent', () => {
    let component: UserAgreementFormComponent;
    let fixture: ComponentFixture<UserAgreementFormComponent>;

    let mockUserService: any;
    let mockAuthService: any;
    let mockRouter: any;
    let mockLogger: any;
    let mockAnalytics: any;
    let mockSnackBar: any;
    let mockDialogRef: any;

    const mockUser: User = {
        uid: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        acceptedPrivacyPolicy: false,
        acceptedDataPolicy: false,
        acceptedTrackingPolicy: false,
        acceptedDiagnosticsPolicy: false, // Initial state
        privacy: Privacy.Private
    } as User;

    beforeEach(async () => {
        mockUserService = {
            createOrUpdateUser: vi.fn().mockResolvedValue(true)
        };
        mockAuthService = {};
        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true)
        };
        mockLogger = {
            error: vi.fn()
        };
        mockAnalytics = {
            logEvent: vi.fn()
        };
        mockSnackBar = {
            open: vi.fn()
        };
        mockDialogRef = {
            close: vi.fn()
        };

        await TestBed.configureTestingModule({
            declarations: [UserAgreementFormComponent],
            imports: [
                ReactiveFormsModule,
                FormsModule,
                MatDialogModule,
                MatSnackBarModule,
                MatCheckboxModule,
                MatCardModule,
                MatDividerModule,
                NoopAnimationsModule
            ],
            providers: [
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: { user: { ...mockUser }, signInMethod: 'google' } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: LoggerService, useValue: mockLogger },
                { provide: AppAnalyticsService, useValue: mockAnalytics },
                { provide: MatSnackBar, useValue: mockSnackBar }
            ]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(UserAgreementFormComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize form with user values', () => {
        expect(component.userFormGroup).toBeDefined();
        expect(component.userFormGroup.get('acceptPrivacyPolicy')?.value).toBe(false);
        expect(component.userFormGroup.get('acceptDataPolicy')?.value).toBe(false);
        expect(component.userFormGroup.get('acceptTrackingPolicy')?.value).toBe(false);
        // Diagnostics should NOT be in the form
        expect(component.userFormGroup.get('acceptDiagnosticsPolicy')).toBeNull();
    });

    it('should be invalid initially', () => {
        expect(component.userFormGroup.valid).toBe(false);
    });

    it('should be valid when required policies are accepted', () => {
        component.userFormGroup.patchValue({
            acceptPrivacyPolicy: true,
            acceptDataPolicy: true,
            acceptTrackingPolicy: true // Making it true for this test case, though it might be optional in reality depending on validators
        });
        // Note: If tracking is optional in validator, this is fine. If required, we set it true.
        // In the component, requiredTrue is set for tracking too in ngOnInit.

        expect(component.userFormGroup.valid).toBe(true);
    });

    it('should set acceptedDiagnosticsPolicy to true on submit', async () => {
        // Accept everything
        component.userFormGroup.patchValue({
            acceptPrivacyPolicy: true,
            acceptDataPolicy: true,
            acceptTrackingPolicy: true
        });

        const event = { preventDefault: vi.fn() };
        await component.onSubmit(event);

        expect(mockUserService.createOrUpdateUser).toHaveBeenCalled();
        const saveCallArg = mockUserService.createOrUpdateUser.mock.calls[0][0];

        // VERIFICATION: Check that diagnostics policy was implicitly set to true
        expect(saveCallArg.acceptedDiagnosticsPolicy).toBe(true);

        // Also check logical flow
        expect(mockAnalytics.logEvent).toHaveBeenCalledWith('sign_up', { method: 'google' });
        expect(mockRouter.navigate).toHaveBeenCalledWith(['dashboard']);
    });
});
