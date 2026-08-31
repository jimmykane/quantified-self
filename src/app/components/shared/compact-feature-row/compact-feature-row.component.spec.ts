import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { CompactFeatureRowComponent } from './compact-feature-row.component';

@Component({
  standalone: true,
  imports: [CompactFeatureRowComponent],
  template: `
    <app-compact-feature-row
      title="Shared row"
      summary="Shared summary"
      icon="query_stats"
      iconTone="secondary"
    >
      <div class="projected-content">Projected content</div>
      <a compactFeatureRowAction href="/details">View details</a>
    </app-compact-feature-row>
  `,
})
class TestHostComponent {}

describe('CompactFeatureRowComponent', () => {
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
      'article.compact-feature-row',
    );

    expect(row).toBeTruthy();
    expect(row.classList.contains('compact-feature-row--secondary')).toBe(true);
    expect(
      row.querySelector('.compact-feature-row__title').textContent.trim(),
    ).toBe('Shared row');
    expect(
      row.querySelector('.compact-feature-row__summary').textContent.trim(),
    ).toBe('Shared summary');
    expect(
      row.querySelector('.compact-feature-row__icon[data-nosnippet]'),
    ).toBeTruthy();
  });

  it('projects rich content and an optional action into separate regions', () => {
    const body = fixture.nativeElement.querySelector(
      '.compact-feature-row__body',
    );
    const action = fixture.nativeElement.querySelector(
      '.compact-feature-row__action',
    );

    expect(body.querySelector('.projected-content').textContent.trim()).toBe(
      'Projected content',
    );
    expect(body.querySelector('[compactFeatureRowAction]')).toBeNull();
    expect(
      action.querySelector('[compactFeatureRowAction]').textContent.trim(),
    ).toBe('View details');
  });
});
