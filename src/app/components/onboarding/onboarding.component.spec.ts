import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnboardingComponent } from './onboarding.component';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { LoggerService } from '../../services/logger.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Privacy } from '@sports-alliance/sports-lib';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { AppPaymentService } from '../../services/app.payment.service';
import { MatDialog } from '@angular/material/dialog';

describe('OnboardingComponent', () => {
    let component: OnboardingComponent;
    let fixture: ComponentFixture<OnboardingComponent>;
    let mockUserService: any;
    let mockAuthService: any;
    let mockRouter: any;
    let mockLoggerService: any;
    let mockAnalyticsService: any;
    let mockPaymentService: any;
    let mockDialog: any;

    const mockUser = {
        uid: 'test-user-123',
        displayName: 'Test User',
        email: 'test@example.com',
        privacy: Privacy.Private,
        acceptedPrivacyPolicy: false,
        acceptedDataPolicy: false,
        acceptedTrackingPolicy: false,
        acceptedTos: false,
        acceptedMarketingPolicy: false,
        acceptedDiagnosticsPolicy: true,
        settings: {}
    };

    beforeEach(async () => {
        mockUserService = {
            createOrUpdateUser: vi.fn().mockResolvedValue(undefined),
            isPro: vi.fn().mockResolvedValue(false),
            hasPaidAccess: vi.fn().mockResolvedValue(false),
            updateUserProperties: vi.fn().mockResolvedValue(undefined),
            getSubscriptionRole: vi.fn().mockResolvedValue(null)
        };

        mockAuthService = {
            user$: of(mockUser),
            currentUser: { uid: 'test-user-123' }
        };

        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true)
        };

        mockLoggerService = {
            log: vi.fn(),
            error: vi.fn()
        };

        mockAnalyticsService = {
            logEvent: vi.fn()
        };

        mockPaymentService = {
            getProducts: vi.fn().mockReturnValue(of([])),
            getUserSubscriptions: vi.fn().mockReturnValue(of([]))
        };

        mockDialog = {
            open: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [
                OnboardingComponent,
                NoopAnimationsModule
            ],
            providers: [
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: LoggerService, useValue: mockLoggerService },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: AppPaymentService, useValue: mockPaymentService },
                { provide: MatDialog, useValue: mockDialog },
                { provide: Firestore, useValue: {} },
                { provide: Functions, useValue: {} },
                { provide: Auth, useValue: { currentUser: { uid: 'test-user-123' } } }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(OnboardingComponent);
        component = fixture.componentInstance;
        component.user = { ...mockUser } as any;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize termsFormGroup with all policy controls', () => {
        expect(component.termsFormGroup).toBeTruthy();
        expect(component.termsFormGroup.get('acceptPrivacyPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptDataPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptTrackingPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptTos')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptMarketingPolicy')).toBeTruthy();
    });

    it('should mark acceptMarketingPolicy as optional (no validators)', () => {
        const marketingControl = component.termsFormGroup.get('acceptMarketingPolicy');
        expect(marketingControl).toBeTruthy();

        // Set to false, should still be valid (optional)
        marketingControl!.setValue(false);
        expect(marketingControl!.valid).toBe(true);

        // Set to true, should also be valid
        marketingControl!.setValue(true);
        expect(marketingControl!.valid).toBe(true);
    });

    it('should mark acceptTrackingPolicy as optional (no validators)', () => {
        const trackingControl = component.termsFormGroup.get('acceptTrackingPolicy');
        expect(trackingControl).toBeTruthy();

        // Set to false, should still be valid (optional)
        trackingControl!.setValue(false);
        expect(trackingControl!.valid).toBe(true);
    });

    it('should require acceptPrivacyPolicy to be true', () => {
        const privacyControl = component.termsFormGroup.get('acceptPrivacyPolicy');
        expect(privacyControl).toBeTruthy();

        // Set to false, should be invalid (required)
        privacyControl!.setValue(false);
        expect(privacyControl!.valid).toBe(false);

        // Set to true, should be valid
        privacyControl!.setValue(true);
        expect(privacyControl!.valid).toBe(true);
    });

    it('should use form value for optional policies on submit', async () => {
        // Set all required policies to true
        component.termsFormGroup.get('acceptPrivacyPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptDataPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptTos')!.setValue(true);

        // Set optional policies explicitly
        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(false);
        component.termsFormGroup.get('acceptMarketingPolicy')!.setValue(true);

        await component.onTermsSubmit();

        // Required policies should be true
        expect(component.user.acceptedPrivacyPolicy).toBe(true);
        expect(component.user.acceptedDataPolicy).toBe(true);
        expect((component.user as any).acceptedTos).toBe(true);

        // Optional policies should reflect form values
        expect(component.user.acceptedTrackingPolicy).toBe(false);
        expect((component.user as any).acceptedMarketingPolicy).toBe(true);
    });

    it('should preserve false value for acceptMarketingPolicy when unchecked', async () => {
        // Set all required policies to true
        component.termsFormGroup.get('acceptPrivacyPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptDataPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptTos')!.setValue(true);
        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(true);

        // Leave marketing unchecked (false)
        component.termsFormGroup.get('acceptMarketingPolicy')!.setValue(false);

        await component.onTermsSubmit();

        // Marketing should remain false
        expect((component.user as any).acceptedMarketingPolicy).toBe(false);
    });

    it('should call createOrUpdateUser on valid form submission', async () => {
        // Make form valid
        component.termsFormGroup.get('acceptPrivacyPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptDataPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptTos')!.setValue(true);

        await component.onTermsSubmit();

        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(component.user);
    });

    it('should not submit if form is invalid', async () => {
        // Leave required fields as false
        component.termsFormGroup.get('acceptPrivacyPolicy')!.setValue(false);

        await component.onTermsSubmit();

        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
    });

    it('should preserve the same FormGroup instance when user input changes', () => {
        const initialFormGroup = component.termsFormGroup;

        // Simulate user update (e.g., triggered by parent component or service)
        // We create a NEW object reference to simulate what happens with immutable state/observable streams
        component.user = { ...mockUser, acceptedPrivacyPolicy: true };
        component.ngOnChanges({
            user: {
                currentValue: component.user,
                previousValue: mockUser,
                firstChange: false,
                isFirstChange: () => false
            }
        });

        // The form group instance should stay the same
        expect(component.termsFormGroup).toBe(initialFormGroup);

        // And the value should verify it was patched (optional but good sanity check)
        // However, our current logic MIGHT overwrite the value if we just re-init. 
        // The fix will use patchValue, so this confirms the fix behaves as expected 
        // regarding the instance identity.
    });
    it('should NOT overwrite dirty form controls with incoming user data', () => {
        const initialFormGroup = component.termsFormGroup;
        const privacyControl = component.termsFormGroup.get('acceptPrivacyPolicy');

        // User checks the box (making it dirty)
        privacyControl!.setValue(true);
        privacyControl!.markAsDirty();

        // Incoming user data says it's false (e.g. from backend latency)
        component.user = { ...mockUser, acceptedPrivacyPolicy: false };
        component.ngOnChanges({
            user: {
                currentValue: component.user,
                previousValue: mockUser,
                firstChange: false,
                isFirstChange: () => false
            }
        });

        // Should remain TRUE because it was dirty
        expect(privacyControl!.value).toBe(true);
    });
});

