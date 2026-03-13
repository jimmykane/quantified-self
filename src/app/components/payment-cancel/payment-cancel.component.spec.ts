import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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

    it('should render payment actions without custom button override classes', () => {
        const buttons = fixture.debugElement.queryAll(By.css('mat-card-actions button'));

        expect(buttons).toHaveLength(2);
        expect(buttons[0].nativeElement.classList.contains('qs-mat-warn')).toBe(false);
        expect(buttons[1].nativeElement.classList.contains('qs-mat-warn')).toBe(false);
        expect(buttons[0].nativeElement.classList.contains('qs-mat-primary')).toBe(false);
        expect(buttons[1].nativeElement.classList.contains('qs-mat-primary')).toBe(false);
    });

    it('should include a spacer so the actions stay split left and right', () => {
        const actions = fixture.debugElement.query(By.css('mat-card-actions'));
        const spacer = fixture.debugElement.query(By.css('.cancel-card-actions__spacer'));

        expect(actions.nativeElement.classList.contains('cancel-card-actions')).toBe(true);
        expect(spacer).toBeTruthy();
    });
});
