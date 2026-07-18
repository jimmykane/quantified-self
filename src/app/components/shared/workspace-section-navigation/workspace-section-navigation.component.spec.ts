import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MaterialModule } from '../../../modules/material.module';
import {
  WorkspaceSectionNavigationComponent,
  type WorkspaceSectionNavigationItem,
} from './workspace-section-navigation.component';

describe('WorkspaceSectionNavigationComponent', () => {
  let component: WorkspaceSectionNavigationComponent;
  let fixture: ComponentFixture<WorkspaceSectionNavigationComponent>;

  const sections: WorkspaceSectionNavigationItem[] = [
    { id: 'profile', label: 'Profile', description: 'Identity and account controls', icon: 'manage_accounts' },
    { id: 'appearance', label: 'Appearance', description: 'Theme, tracking, and email', icon: 'tune' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [WorkspaceSectionNavigationComponent],
      imports: [MaterialModule, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceSectionNavigationComponent);
    component = fixture.componentInstance;
    component.sections = sections;
    component.activeSection = 'appearance';
    component.navigationLabel = 'Settings';
    component.navigationAriaLabel = 'Settings sections';
  });

  it('renders shared desktop and mobile section navigation', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.workspace-navigation__mobile-tabs a')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.desktop-section-nav a')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.desktop-section-nav-title')?.textContent?.trim()).toBe('Settings');
    expect(fixture.nativeElement.querySelector('.desktop-section-nav a[aria-current="page"]')?.textContent).toContain('Appearance');
  });

  it('emits the selected section from either navigation surface', () => {
    const selected = vi.fn();
    component.sectionSelected.subscribe(selected);
    fixture.detectChanges();

    const desktopSection = fixture.nativeElement.querySelector('.desktop-section-nav a') as HTMLAnchorElement;
    desktopSection.click();

    expect(selected).toHaveBeenCalledWith('profile');
  });
});
