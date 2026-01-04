import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AccountLinkingDialogComponent, AccountLinkingData } from './account-linking-dialog.component';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { Component, Input } from '@angular/core';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { By } from '@angular/platform-browser';

@Component({
    selector: 'mat-icon',
    template: '<span></span>',
    standalone: false
})
class MockMatIcon {
    @Input() svgIcon: any;
    @Input() fontIcon: any;
}

describe('AccountLinkingDialogComponent', () => {
    let component: AccountLinkingDialogComponent;
    let fixture: ComponentFixture<AccountLinkingDialogComponent>;
    let mockDialogRef: any;

    const mockData: AccountLinkingData = {
        email: 'test@example.com',
        existingProviders: ['google.com', 'github.com', 'password'],
        pendingProvider: 'emailLink'
    };

    beforeEach(async () => {
        mockDialogRef = {
            close: vi.fn()
        };

        await TestBed.configureTestingModule({
            declarations: [AccountLinkingDialogComponent, MockMatIcon],
            imports: [
                MatDialogModule
            ],
            providers: [
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: mockData }
            ],
            schemas: [NO_ERRORS_SCHEMA] // Ignore unknown elements if any (though we import MatIcon)
        }).compileComponents();

        fixture = TestBed.createComponent(AccountLinkingDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should display the correct email', () => {
        const compiled = fixture.nativeElement;
        expect(compiled.querySelector('.description').textContent).toContain('test@example.com');
    });

    it('should display the correct pending provider name', () => {
        // pendingProvider is 'emailLink', getProviderName('emailLink') -> 'EmailLink' (or logic in component)
        // Component logic: providerId.split('.')[0] -> 'emailLink' -> 'Emaillink'? 
        // check implementation: name.charAt(0).toUpperCase() + name.slice(1);
        // 'emailLink' -> 'EmailLink'
        // Wait, let's check the component implementation again if needed.
        // But typically we expect it to be rendered.
        const compiled = fixture.nativeElement;
        // Depending on exact text structure. 
        // "to link your new EmailLink login."
        expect(compiled.textContent).toContain('EmailLink');
    });

    it('should render buttons for all existing providers', () => {
        const buttons = fixture.debugElement.queryAll(By.css('.provider-button'));
        expect(buttons.length).toBe(3);
    });

    it('should close dialog with "google.com" when Google button is clicked', () => {
        const googleButton = fixture.debugElement.query(By.css('.provider-button.google'));
        googleButton.triggerEventHandler('click', null);
        expect(mockDialogRef.close).toHaveBeenCalledWith('google.com');
    });

    it('should close dialog with "github.com" when GitHub button is clicked', () => {
        const githubButton = fixture.debugElement.query(By.css('.provider-button.github'));
        githubButton.triggerEventHandler('click', null);
        expect(mockDialogRef.close).toHaveBeenCalledWith('github.com');
    });

    it('should close dialog with "emailLink" when Magic Link button is clicked', () => {
        // The button for 'password' provider triggers 'emailLink' selection
        const emailButton = fixture.debugElement.query(By.css('.provider-button.email'));
        emailButton.triggerEventHandler('click', null);
        expect(mockDialogRef.close).toHaveBeenCalledWith('emailLink');
    });

    it('should close dialog with null when Cancel is clicked', () => {
        const cancelButton = fixture.debugElement.query(By.css('.cancel-button'));
        cancelButton.triggerEventHandler('click', null);
        expect(mockDialogRef.close).toHaveBeenCalledWith(null);
    });
});
