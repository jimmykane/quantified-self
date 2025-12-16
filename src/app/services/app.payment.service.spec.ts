import { TestBed } from '@angular/core/testing';
import { AppPaymentService } from './app.payment.service';
import { FirebaseApp, provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { AppWindowService } from './app.window.service';

// Mock values
const mockFirebaseApp = {};
const mockWindowService = {
    currentDomain: 'http://localhost:4200'
};

describe('AppPaymentService', () => {
    let service: AppPaymentService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AppPaymentService,
                { provide: FirebaseApp, useValue: mockFirebaseApp },
                { provide: AppWindowService, useValue: mockWindowService }
            ]
        });
        service = TestBed.inject(AppPaymentService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });
});
