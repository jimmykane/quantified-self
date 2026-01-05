import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaymentCancelComponent } from './payment-cancel.component';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

describe('PaymentCancelComponent', () => {
    let component: PaymentCancelComponent;
    let fixture: ComponentFixture<PaymentCancelComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PaymentCancelComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: { queryParams: of({}) }
                }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(PaymentCancelComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
