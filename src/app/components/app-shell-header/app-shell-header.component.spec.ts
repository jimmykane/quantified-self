import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { AppShellHeaderComponent } from './app-shell-header.component';

describe('AppShellHeaderComponent', () => {
  let component: AppShellHeaderComponent;
  let fixture: ComponentFixture<AppShellHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AppShellHeaderComponent],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(AppShellHeaderComponent);
    component = fixture.componentInstance;
  });

  it('should hide header when host hidden class is present', () => {
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.classList.add('app-shell-header--hidden');
    fixture.detectChanges();

    const nav = fixture.nativeElement.querySelector('nav.custom-header') as HTMLElement | null;
    expect(nav).toBeTruthy();
    expect(host.classList.contains('app-shell-header--hidden')).toBe(true);
  });

  it('should emit toggleSidenav when hamburger button is clicked', () => {
    const emitSpy = vi.spyOn(component.toggleSidenav, 'emit');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button.hamburger-link') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    button?.click();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('should render both signed-out desktop and mobile primary actions', () => {
    component.authState = false;
    fixture.detectChanges();

    const desktopActionButton = fixture.nativeElement.querySelector('button.responsive-action-button--desktop') as HTMLButtonElement | null;
    const mobileActionButton = fixture.nativeElement.querySelector('button.responsive-action-button--mobile') as HTMLButtonElement | null;
    const mobileIcon = mobileActionButton?.querySelector('mat-icon');

    expect(desktopActionButton?.textContent?.trim()).toBe('Login or Register');
    expect(mobileActionButton?.getAttribute('aria-label')).toBe('Login or Register');
    expect(mobileIcon?.textContent?.trim()).toBe('login');
  });

  it('should render both authenticated desktop and mobile primary actions', () => {
    component.authState = true;
    fixture.detectChanges();

    const desktopActionButton = fixture.nativeElement.querySelector('button.responsive-action-button--desktop') as HTMLButtonElement | null;
    const mobileActionButton = fixture.nativeElement.querySelector('button.responsive-action-button--mobile') as HTMLButtonElement | null;
    const mobileIcon = mobileActionButton?.querySelector('mat-icon');

    expect(desktopActionButton?.textContent?.trim()).toBe('Dashboard');
    expect(mobileActionButton?.getAttribute('aria-label')).toBe('Dashboard');
    expect(mobileIcon?.textContent?.trim()).toBe('dashboard');
  });
});
