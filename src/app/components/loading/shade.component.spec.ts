import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { By } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('should render pass-through error states as a themed panel without a dimming wash', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/loading/shade.component.css');
    const styles = readFileSync(stylePath, 'utf8');

    expect(styles).toContain('.loading-shade.pass-through {');
    expect(styles).toContain('background: transparent;');
    expect(styles).toContain('padding: 16px;');
    expect(styles).toContain('.loading-shade.pass-through .error {');
    expect(styles).toContain('width: min(320px, 100%);');
    expect(styles).toContain('background: var(--qs-overlay-surface);');
    expect(styles).toContain('border: 1px solid var(--qs-overlay-surface-border);');
    expect(styles).toContain('border-radius: 8px;');
    expect(styles).toContain('color: var(--mat-sys-on-surface);');
    expect(styles).toContain('.loading-shade.pass-through .error-copy {');
    expect(styles).toContain('display: contents;');
    expect(styles).toContain('.loading-shade.pass-through .error-copy .hint {');
    expect(styles).toContain('color: var(--mat-sys-on-surface-variant);');
  });
});
