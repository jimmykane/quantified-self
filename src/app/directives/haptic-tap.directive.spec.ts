import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../services/app.haptics.service';
import { HapticTapDirective } from './haptic-tap.directive';

@Component({
  template: `
    <button id="default-btn" appHapticTap>Default</button>
    <button id="success-btn" appHapticTap="success">Success</button>
    <button id="disabled-btn" appHapticTap [appHapticTapDisabled]="isDisabled">Disabled</button>
    <button id="aria-disabled-btn" appHapticTap aria-disabled="true">Aria disabled</button>
  `,
  standalone: false,
})
class TestHostComponent {
  isDisabled = false;
}

describe('HapticTapDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let hostComponent: TestHostComponent;
  let hapticsMock: {
    selection: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    hapticsMock = {
      selection: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [TestHostComponent, HapticTapDirective],
      providers: [
        { provide: AppHapticsService, useValue: hapticsMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    hostComponent = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('triggers selection haptic by default', () => {
    const button = fixture.debugElement.query(By.css('#default-btn')).nativeElement as HTMLButtonElement;

    button.click();

    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(hapticsMock.warning).not.toHaveBeenCalled();
    expect(hapticsMock.error).not.toHaveBeenCalled();
  });

  it('triggers success haptic for explicit success mode', () => {
    const button = fixture.debugElement.query(By.css('#success-btn')).nativeElement as HTMLButtonElement;

    button.click();

    expect(hapticsMock.success).toHaveBeenCalledTimes(1);
    expect(hapticsMock.selection).not.toHaveBeenCalled();
  });

  it('does not trigger haptics when directive is disabled', () => {
    hostComponent.isDisabled = true;
    fixture.detectChanges();
    const button = fixture.debugElement.query(By.css('#disabled-btn')).nativeElement as HTMLButtonElement;

    button.click();

    expect(hapticsMock.selection).not.toHaveBeenCalled();
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(hapticsMock.warning).not.toHaveBeenCalled();
    expect(hapticsMock.error).not.toHaveBeenCalled();
  });

  it('does not trigger haptics when aria-disabled is true', () => {
    const button = fixture.debugElement.query(By.css('#aria-disabled-btn')).nativeElement as HTMLButtonElement;

    button.click();

    expect(hapticsMock.selection).not.toHaveBeenCalled();
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(hapticsMock.warning).not.toHaveBeenCalled();
    expect(hapticsMock.error).not.toHaveBeenCalled();
  });
});
