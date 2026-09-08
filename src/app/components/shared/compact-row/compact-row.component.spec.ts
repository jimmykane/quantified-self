import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, beforeEach } from 'vitest';
import { CompactRowComponent } from './compact-row.component';

@Component({
  standalone: true,
  imports: [CompactRowComponent],
  template: `
    <app-compact-row
      title="Shared row"
      summary="Shared summary"
      icon="query_stats"
      iconTone="secondary"
      [showDivider]="false"
    >
      <div class="projected-content">Projected content</div>
      <a compactRowAction href="/details">View details</a>
    </app-compact-row>
  `,
})
class TestHostComponent {}

describe('CompactRowComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, MatIconTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('renders a semantic row with shared copy and icon treatment', () => {
    const row = fixture.nativeElement.querySelector(
      'article.compact-row',
    );

    expect(row).toBeTruthy();
    expect(row.classList.contains('compact-row--secondary')).toBe(true);
    expect(
      row.querySelector('.compact-row__title').textContent.trim(),
    ).toBe('Shared row');
    expect(
      row.querySelector('.compact-row__summary').textContent.trim(),
    ).toBe('Shared summary');
    expect(
      row.querySelector('.compact-row__icon[data-nosnippet]'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('app-compact-row').classList,
    ).toContain('compact-row-host--without-divider');
  });

  it('projects rich content and an optional action into separate regions', () => {
    const body = fixture.nativeElement.querySelector(
      '.compact-row__body',
    );
    const action = fixture.nativeElement.querySelector(
      '.compact-row__action',
    );

    expect(body.querySelector('.projected-content').textContent.trim()).toBe(
      'Projected content',
    );
    expect(body.querySelector('[compactRowAction]')).toBeNull();
    expect(
      action.querySelector('[compactRowAction]').textContent.trim(),
    ).toBe('View details');
  });

  it('defaults to the existing public column layout and comfortable density', () => {
    const row = fixture.debugElement.query(By.directive(CompactRowComponent)).componentInstance as CompactRowComponent;
    expect(row.layout()).toBe('columns');
    expect(row.density()).toBe('comfortable');
    expect(fixture.nativeElement.querySelector('article').classList).toContain('compact-row--columns');
    expect(fixture.nativeElement.querySelector('h3')?.textContent).toBe('Shared row');
    expect(fixture.nativeElement.querySelector('h3')?.hasAttribute('id')).toBe(false);
  });

  it('supports a compact stacked workspace row with a labelled heading and optional icon', () => {
    const compactFixture = TestBed.createComponent(CompactRowComponent);
    compactFixture.componentRef.setInput('title', 'Shared row');
    compactFixture.componentRef.setInput('layout', 'stacked');
    compactFixture.componentRef.setInput('density', 'compact');
    compactFixture.componentRef.setInput('headingLevel', 2);
    compactFixture.componentRef.setInput('titleId', 'workspace-section');
    compactFixture.detectChanges();

    const article = compactFixture.nativeElement.querySelector('article');
    expect(article.classList).toContain('compact-row--stacked');
    expect(article.classList).toContain('compact-row--compact');
    expect(article.classList).toContain('compact-row--without-icon');
    expect(article.getAttribute('aria-labelledby')).toBe('workspace-section');
    expect(article.querySelector('h2#workspace-section')?.textContent).toBe('Shared row');
    expect(article.querySelector('.compact-row__icon')).toBeNull();
    expect(article.querySelector('.compact-row__summary')).toBeNull();
    expect(article.querySelector('.compact-row__body [compactRowAction]')).toBeNull();
  });
});
