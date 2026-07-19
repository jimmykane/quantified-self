import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('stacks section icons above labels so tabs do not overlap', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/shared/workspace-section-navigation/workspace-section-navigation.component.scss'),
      'utf8'
    );
    const labelRule = styles.match(/\.workspace-navigation__tab-label\s*\{[^}]*\}/)?.[0] ?? '';

    expect(labelRule).toContain('flex-direction: column');
    expect(labelRule).toContain('white-space: normal');
    expect(labelRule).toContain('text-align: center');
  });

  it('centers both mobile scroll icons inside their controls', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/shared/workspace-section-navigation/workspace-section-navigation.component.scss'),
      'utf8'
    );
    const controlRule = styles.match(/\.workspace-navigation__scroll-control\s*\{[^}]*\}/)?.[0] ?? '';
    const iconRule = styles.match(/\.workspace-navigation__scroll-control mat-icon\s*\{[^}]*\}/)?.[0] ?? '';

    expect(controlRule).toContain('display: inline-flex');
    expect(controlRule).toContain('align-items: center');
    expect(controlRule).toContain('justify-content: center');
    expect(controlRule).toContain('padding: 0');
    expect(iconRule).toContain('align-items: center');
    expect(iconRule).toContain('justify-content: center');
    expect(iconRule).toContain('line-height: 24px');
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
