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
    component.navigationAriaLabel = 'Settings sections';
  });

  it('renders horizontal section navigation without a workspace rail', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.workspace-navigation__mobile-tabs a')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.desktop-section-nav')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="tabpanel"]')?.getAttribute('aria-label')).toBe('Settings sections content');
  });

  it('emits the selected section from the horizontal navigation', () => {
    const selected = vi.fn();
    component.sectionSelected.subscribe(selected);
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector('.workspace-navigation__mobile-tab') as HTMLAnchorElement;
    section.click();

    expect(selected).toHaveBeenCalledWith('profile');
  });

  it('brings a visible active mobile section into view', () => {
    const scrollIntoView = vi.fn();
    component.activeSection = 'profile';
    (component as any).mobileSectionTabs = {
      get: vi.fn(() => ({
        nativeElement: {
          getClientRects: () => [{}],
          scrollIntoView,
        },
      })),
    };
    component.ngAfterViewChecked();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' });
  });

  it('shows mobile overflow affordances and scrolls the section strip', () => {
    const scrollBy = vi.fn();
    (component as any).mobileNavigation = {
      nativeElement: {
        clientWidth: 300,
        scrollWidth: 700,
        scrollLeft: 120,
        scrollBy,
      },
    };

    component.updateMobileNavigationScrollState();
    component.scrollMobileNavigation(1);

    expect(component.canScrollMobileBackward).toBe(true);
    expect(component.canScrollMobileForward).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ left: 210, behavior: 'smooth' });
  });

  it('recalculates overflow affordances when the viewport changes', () => {
    (component as any).lastVisibleActiveSection = 'appearance';
    (component as any).mobileNavigation = {
      nativeElement: {
        clientWidth: 300,
        scrollWidth: 700,
        scrollLeft: 0,
      },
    };

    component.handleViewportResize();

    expect((component as any).lastVisibleActiveSection).toBe('');
    expect(component.canScrollMobileBackward).toBe(false);
    expect(component.canScrollMobileForward).toBe(true);
  });
});
