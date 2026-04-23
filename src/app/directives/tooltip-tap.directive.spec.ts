import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatTooltip, MatTooltipModule } from '@angular/material/tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppWindowService } from '../services/app.window.service';
import { TooltipTapDirective } from './tooltip-tap.directive';

@Component({
  template: `
    <button id="tooltip-btn" matTooltip="Tooltip text" appTooltipTap>Tooltip</button>
    <button id="empty-tooltip-btn" [matTooltip]="emptyTooltipText" appTooltipTap>Empty tooltip</button>
  `,
  standalone: false,
})
class TestHostComponent {
  emptyTooltipText = '';
}

describe('TooltipTapDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let windowServiceMock: { windowRef: { matchMedia: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    windowServiceMock = {
      windowRef: {
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      },
    };

    await TestBed.configureTestingModule({
      declarations: [TestHostComponent, TooltipTapDirective],
      imports: [MatTooltipModule, NoopAnimationsModule],
      providers: [{ provide: AppWindowService, useValue: windowServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows and auto-hides tooltip on coarse-pointer tap', () => {
    vi.useFakeTimers();

    const tooltipDebugElement = fixture.debugElement.queryAll(By.directive(MatTooltip))[0];
    const tooltipDirective = tooltipDebugElement.injector.get(MatTooltip);
    const tooltipShowSpy = vi.spyOn(tooltipDirective, 'show');
    const tooltipHideSpy = vi.spyOn(tooltipDirective, 'hide');

    const button = fixture.nativeElement.querySelector('#tooltip-btn') as HTMLButtonElement;
    button.click();

    expect(tooltipShowSpy).toHaveBeenCalledWith(0);
    vi.advanceTimersByTime(2200);
    expect(tooltipHideSpy).toHaveBeenCalledWith(0);
  });

  it('does not show tooltip for non-coarse pointers', () => {
    windowServiceMock.windowRef.matchMedia.mockReturnValue({ matches: false });
    fixture.detectChanges();

    const tooltipDebugElement = fixture.debugElement.queryAll(By.directive(MatTooltip))[0];
    const tooltipDirective = tooltipDebugElement.injector.get(MatTooltip);
    const tooltipShowSpy = vi.spyOn(tooltipDirective, 'show');

    const button = fixture.nativeElement.querySelector('#tooltip-btn') as HTMLButtonElement;
    button.click();

    expect(tooltipShowSpy).not.toHaveBeenCalled();
  });

  it('does not show tooltip when message is empty', () => {
    const emptyTooltipDebugElement = fixture.debugElement.queryAll(By.directive(MatTooltip))[1];
    const emptyTooltipDirective = emptyTooltipDebugElement.injector.get(MatTooltip);
    const tooltipShowSpy = vi.spyOn(emptyTooltipDirective, 'show');

    const button = fixture.nativeElement.querySelector('#empty-tooltip-btn') as HTMLButtonElement;
    button.click();

    expect(tooltipShowSpy).not.toHaveBeenCalled();
  });
});

