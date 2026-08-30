import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatButtonModule } from '@angular/material/button';
import { describe, expect, it, beforeEach } from 'vitest';
import { PublicFooterComponent } from './public-footer.component';

describe('PublicFooterComponent', () => {
  let fixture: ComponentFixture<PublicFooterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PublicFooterComponent],
      imports: [RouterTestingModule.withRoutes([]), MatButtonModule],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicFooterComponent);
    fixture.detectChanges();
  });

  it('renders product, support, legal, and company information', () => {
    const footer = fixture.nativeElement.querySelector('.public-footer') as HTMLElement | null;
    const text = footer?.textContent ?? '';

    expect(footer).toBeTruthy();
    expect(text).toContain('Activity calendar');
    expect(text).toContain('Training analysis');
    expect(text).toContain('MCP server');
    expect(text).toContain('Wahoo integration');
    expect(footer?.querySelector('a[href="/features/activity-calendar"]')).toBeTruthy();
    expect(footer?.querySelector('a[href="/features/mcp-server"]')).toBeTruthy();
    expect(footer?.querySelector('a[href="/integrations/wahoo"]')).toBeTruthy();
    expect(footer?.querySelector('a[href="/privacy"]')).toBeTruthy();
    expect(footer?.querySelector('a[href="/terms"]')).toBeTruthy();
    expect(footer?.querySelector('a[href="/policies"]')).toBeTruthy();
    expect(text).toContain('provided without warranty');
    expect(text).toContain('AGPL-3.0-only');
    expect(
      footer?.querySelector('a[href="https://github.com/jimmykane/quantified-self"]'),
    ).toBeTruthy();
    expect(
      footer?.querySelector('a[href="https://github.com/jimmykane/quantified-self/blob/main/LICENSE"]'),
    ).toBeTruthy();
    expect(text).toContain('Help & support');
    expect(text).toContain('Quantified Self IO');
    expect(text).toContain('Kaloudi 15');
    expect(text).toContain('45500 Ioannina');
    expect(text).toContain('Greece');
    expect(text).toContain('support@quantified-self.io');
    expect(text).toContain('contact@quantified-self.io');
    expect(text).not.toMatch(/\bprivate\b/i);
    expect(footer?.querySelector('a[href="mailto:support@quantified-self.io"]')).toBeTruthy();
    expect(footer?.querySelector('a[href="mailto:contact@quantified-self.io"]')).toBeTruthy();
  });
});
