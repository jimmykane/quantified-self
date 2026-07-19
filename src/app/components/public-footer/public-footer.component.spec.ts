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

  it('renders product, support, legal, and operator information', () => {
    const footer = fixture.nativeElement.querySelector('.public-footer') as HTMLElement | null;
    const text = footer?.textContent ?? '';

    expect(footer).toBeTruthy();
    expect(text).toContain('Training analysis');
    expect(text).toContain('Help & support');
    expect(text).toContain('Dimitrios Kanellopoulos');
    expect(text).toContain('Kaloudi 15');
    expect(text).toContain('45500 Ioannina');
    expect(text).toContain('Greece');
    expect(text).toContain('support@quantified-self.io');
    expect(text).toContain('contact@quantified-self.io');
    expect(footer?.querySelector('a[href="mailto:support@quantified-self.io"]')).toBeTruthy();
    expect(footer?.querySelector('a[href="mailto:contact@quantified-self.io"]')).toBeTruthy();
  });
});
