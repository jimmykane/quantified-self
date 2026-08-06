import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { PageHeaderComponent } from './page-header.component';

@Component({
  standalone: true,
  imports: [PageHeaderComponent],
  template: `
    <app-page-header
      [title]="title"
      titleId="test-page-title"
      [eyebrow]="eyebrow"
      [subtitle]="subtitle"
      [headingLevel]="headingLevel"
      [variant]="variant"
      [status]="status">
      <button pageHeaderLeading type="button">Open calendar</button>
      <button pageHeaderActions type="button">Action</button>
    </app-page-header>
  `,
})
class PageHeaderHostComponent {
  title: string | null = 'Training';
  eyebrow: string | null = '28-day training analysis';
  subtitle: string | null = 'Data through Thursday, 6 August 2026';
  headingLevel: 1 | 2 = 1;
  variant: 'route' | 'compact' = 'route';
  status: 'pending' | 'warning' | null = null;
}

describe('PageHeaderComponent', () => {
  async function createFixture(): Promise<ComponentFixture<PageHeaderHostComponent>> {
    await TestBed.configureTestingModule({ imports: [PageHeaderHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(PageHeaderHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a route heading with contextual copy and projected controls', async () => {
    const fixture = await createFixture();
    const header = fixture.nativeElement.querySelector('.qs-page-header') as HTMLElement;

    expect(header.getAttribute('aria-labelledby')).toBe('test-page-title');
    expect(header.querySelector('.qs-page-header__eyebrow')?.textContent?.trim()).toBe('28-day training analysis');
    expect(header.querySelector('h1#test-page-title')?.textContent?.trim()).toBe('Training');
    expect(header.querySelector('.qs-page-header__subtitle')?.textContent?.trim())
      .toBe('Data through Thursday, 6 August 2026');
    expect(header.querySelector('[pageHeaderLeading]')?.textContent?.trim()).toBe('Open calendar');
    expect(header.querySelector('[pageHeaderActions]')?.textContent?.trim()).toBe('Action');
  });

  it('renders compact warning status as an alert with a level-two heading', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.title = 'Derived metrics update failed';
    fixture.componentInstance.eyebrow = null;
    fixture.componentInstance.subtitle = 'Some values may be out of date.';
    fixture.componentInstance.headingLevel = 2;
    fixture.componentInstance.variant = 'compact';
    fixture.componentInstance.status = 'warning';
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('.qs-page-header') as HTMLElement;
    expect(header.getAttribute('role')).toBe('alert');
    expect(header.classList).toContain('qs-page-header--compact');
    expect(header.querySelector('.qs-page-header__status-icon')?.textContent?.trim()).toBe('error_outline');
    expect(header.querySelector('h2#test-page-title')?.textContent?.trim()).toBe('Derived metrics update failed');
  });
});
