import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { NotFoundComponent } from './not-found.component';

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        NotFoundComponent,
        RouterTestingModule.withRoutes([]),
        MatIconTestingModule,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
  });

  it('renders a helpful not-found message and recovery links', () => {
    const text = fixture.nativeElement.textContent as string;
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map(link => link.getAttribute('href'));

    expect(text).toContain('Page not found');
    expect(text).toContain('The page may have moved');
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/integrations');
  });
});
