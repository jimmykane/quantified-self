import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { OverlayContainer } from '@angular/cdk/overlay';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HapticTapDirective } from '../../../directives/haptic-tap.directive';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { DurabilityReadingGuideComponent } from './durability-reading-guide.component';

describe('DurabilityReadingGuideComponent', () => {
  let fixture: ComponentFixture<DurabilityReadingGuideComponent>;
  let breakpointSubject: BehaviorSubject<{ matches: boolean }>;
  let overlayContainer: OverlayContainer;

  beforeEach(async () => {
    breakpointSubject = new BehaviorSubject({ matches: false });

    await TestBed.configureTestingModule({
      imports: [
        CommonModule,
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        MatMenuModule,
        NoopAnimationsModule,
      ],
      declarations: [DurabilityReadingGuideComponent, HapticTapDirective],
      providers: [
        { provide: BreakpointObserver, useValue: { observe: vi.fn(() => breakpointSubject.asObservable()) } },
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
      ],
    }).compileComponents();

    overlayContainer = TestBed.inject(OverlayContainer);
    fixture = TestBed.createComponent(DurabilityReadingGuideComponent);
  });

  afterEach(() => {
    overlayContainer.getContainerElement().replaceChildren();
  });

  it('opens the concise event guide in a desktop Material menu', async () => {
    fixture.componentInstance.context = 'event';
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[aria-label="How to read durability"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    const text = overlayContainer.getContainerElement().textContent ?? '';
    expect(text).toContain('How to read durability');
    expect(text).toContain('If you deliberately eased off, changed terrain, coasted, or changed pace');
    expect(text).not.toContain('Across your Training');
  });

  it('uses the same readable guide in a phone dialog, with Training trend guidance', async () => {
    fixture.componentInstance.context = 'training';
    breakpointSubject.next({ matches: true });
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[aria-label="How to read durability"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    const text = overlayContainer.getContainerElement().textContent ?? '';
    expect(text).toContain('Across your Training');
    expect(text).toContain('Use the weekly trail to look for a pattern, not one score.');
    expect(text).toContain('no suitable comparison, not zero durability');
  });
});
