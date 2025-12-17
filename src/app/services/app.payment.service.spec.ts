import { TestBed } from '@angular/core/testing';
import { AppPaymentService } from './app.payment.service';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import { FirebaseApp } from '@angular/fire/app';
import { AppWindowService } from './app.window.service';

// Mock values
const mockFirebaseApp = {};
const mockWindowService = {
    currentDomain: 'http://localhost:4200'
};
const mockFirestore = {};
const mockAuth = {};
const mockFunctions = {};
const mockDialog = { open: () => ({ afterClosed: () => ({ pipe: () => ({ subscribe: () => { } }) }) }) };

describe('AppPaymentService', () => {
    let service: AppPaymentService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AppPaymentService,
                { provide: FirebaseApp, useValue: mockFirebaseApp },
                { provide: AppWindowService, useValue: mockWindowService },
                { provide: Firestore, useValue: mockFirestore },
                { provide: Auth, useValue: mockAuth },
                { provide: Functions, useValue: mockFunctions },
                { provide: MatDialog, useValue: mockDialog }
            ]
        });
        service = TestBed.inject(AppPaymentService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });
});
