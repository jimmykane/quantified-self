import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { RouterTestingModule } from '@angular/router/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { PublicFooterComponent } from '../public-footer/public-footer.component';
import { PublicLayoutComponent } from './public-layout.component';

describe('PublicLayoutComponent', () => {
  let fixture: ComponentFixture<PublicLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [PublicLayoutComponent, PublicFooterComponent],
      imports: [MatButtonModule, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicLayoutComponent);
    fixture.detectChanges();
  });

  it('renders routed public content followed by the shared site footer', () => {
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-public-footer')).toBeTruthy();
  });
});
