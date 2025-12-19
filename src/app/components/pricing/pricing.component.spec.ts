import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PricingComponent } from './pricing.component';
import { AppUserService } from '../../services/app.user.service';
import { AppPaymentService } from '../../services/app.payment.service';
import { of } from 'rxjs';

class MockAppPaymentService {
    getProducts() {
        return of([]);
    }
    getUserSubscriptions() {
        return of([]);
    }
}

class MockAppUserService {
    getSubscriptionRole() {
        return Promise.resolve('free');
    }
}

import { MatDialog } from '@angular/material/dialog';

class MockMatDialog {
    open() {
        return {
            afterClosed: () => of(true)
        };
    }
}

describe('PricingComponent', () => {
    let component: PricingComponent;
    let fixture: ComponentFixture<PricingComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PricingComponent],
            providers: [
                { provide: AppPaymentService, useClass: MockAppPaymentService },
                { provide: AppUserService, useClass: MockAppUserService },
                { provide: MatDialog, useClass: MockMatDialog }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(PricingComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
