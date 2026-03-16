import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { ShadeComponent } from './shade.component';

describe('ShadeComponent', () => {
  let component: ShadeComponent;
  let fixture: ComponentFixture<ShadeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ShadeComponent],
      imports: [MatProgressBarModule, MatIconModule]
    }).compileComponents();

    fixture = TestBed.createComponent(ShadeComponent);
    component = fixture.componentInstance;
  });

  it('should add a pass-through class for inactive error shades when enabled', () => {
    component.isActive = false;
    component.hasError = true;
    component.allowErrorPassthrough = true;

    fixture.detectChanges();

    const shade = fixture.debugElement.query(By.css('.loading-shade'));
    expect(shade.nativeElement.classList).toContain('error-state');
    expect(shade.nativeElement.classList).toContain('pass-through');
  });

  it('should keep the active loading shade blocking interactions', () => {
    component.isActive = true;
    component.hasError = true;
    component.allowErrorPassthrough = true;

    fixture.detectChanges();

    const shade = fixture.debugElement.query(By.css('.loading-shade'));
    expect(shade.nativeElement.classList).not.toContain('pass-through');
  });
});
