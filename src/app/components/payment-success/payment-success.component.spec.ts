import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentSuccessComponent } from './payment-success.component';
import { ActivatedRoute } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { of } from 'rxjs';

describe('PaymentSuccessComponent', () => {
    let component: PaymentSuccessComponent;
    let fixture: ComponentFixture<PaymentSuccessComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PaymentSuccessComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: { queryParams: of({}) }
                },
                {
                    provide: Auth,
                    useValue: { currentUser: { uid: 'test-uid', getIdTokenResult: () => Promise.resolve({ claims: {} }) } }
                }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(PaymentSuccessComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
