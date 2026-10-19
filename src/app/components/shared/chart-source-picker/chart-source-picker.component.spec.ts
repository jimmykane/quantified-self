import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartSourcePickerComponent } from './chart-source-picker.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { ChartSourceChoice } from '../../../helpers/chart-source.helper';

describe('compact chart source picker', () => {
  const haptics = { selection: vi.fn() };
  const choices = ['Suunto', 'Garmin'].map((provider, index) => ({ key: `${index}`, label: `${provider} · Sleep session · Provider calculated`,
    shortLabel: `${provider} · Main sleep`, sourceLabel: provider, detail: 'Sleep session · Provider calculated' }));
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ imports: [ChartSourcePickerComponent, NoopAnimationsModule], providers: [{ provide: AppHapticsService, useValue: haptics }] });
  });
  function create(options: ChartSourceChoice[] = choices, key: string | null = '0') {
    const fixture = TestBed.createComponent(ChartSourcePickerComponent);
    fixture.componentRef.setInput('choices', options); fixture.componentRef.setInput('selectedKey', key);
    fixture.componentRef.setInput('chartTitle', 'Sleep duration'); fixture.detectChanges(); return fixture;
  }
  it('chooses a measurement first and offers only matching providers in its source menu', async () => {
    const daytime = choices.map(choice => ({ ...choice, readingKey: 'daytime', readingLabel: 'Throughout the day', readingMethod: 'Recorded intervals' }));
    const fixture = create([...daytime, { ...choices[0], key: 'sleep', readingKey: 'sleep-average', readingLabel: 'Average sleep HR' }]);
    const changed = vi.fn(); fixture.componentInstance.selected.subscribe(changed);
    expect(fixture.nativeElement.querySelector('mat-select')?.getAttribute('aria-label')).toBe('Heart rate measurement');
    expect(fixture.componentInstance.sourceChoices().map(choice => choice.key)).toEqual(['0', '1']);
    expect(fixture.nativeElement.querySelector('mat-select').compareDocumentPosition(fixture.nativeElement.querySelector('button')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fixture.nativeElement.querySelector('button').click(); fixture.detectChanges(); await fixture.whenStable();
    expect(TestBed.inject(OverlayContainer).getContainerElement().querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    fixture.componentInstance.choose('sleep');
    expect(changed).not.toHaveBeenCalled();
    fixture.componentInstance.chooseMeasurement('sleep-average');
    expect(changed).toHaveBeenCalledExactlyOnceWith('sleep');
    fixture.componentRef.setInput('selectedKey', 'sleep'); fixture.detectChanges();
    expect(fixture.componentInstance.sourceChoices().map(choice => choice.key)).toEqual(['sleep']);
    fixture.componentInstance.chooseMeasurement('sleep-average'); fixture.componentInstance.chooseMeasurement('unknown');
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('compacts Health history labels without losing measurement controls or accessible attribution', () => {
    const daytime = choices.map(choice => ({ ...choice, readingKey: 'daytime', readingLabel: 'Throughout the day', readingMethod: 'Recorded by your watch' }));
    const fixture = create([...daytime, { ...choices[0], key: 'sleep', readingKey: 'sleep-average', readingLabel: 'Average sleep HR' }]);
    expect(fixture.nativeElement.querySelector('.chart-reading-method')?.textContent).toBe('Recorded by your watch');
    fixture.componentRef.setInput('compact', true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-reading-method')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-reading-picker > span')?.classList.contains('cdk-visually-hidden')).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-select')?.getAttribute('aria-label')).toBe('Heart rate measurement');
    expect(fixture.nativeElement.querySelector('button')?.getAttribute('aria-label')).toContain('Suunto');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('shows attribution without a redundant control when only one reading is available', () => {
    const fixture = create(choices.slice(0, 1));
    expect(fixture.nativeElement.textContent).toContain('Suunto · Main sleep');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('opens full descriptions with checked state and emits only an accepted change', async () => {
    const fixture = create(); const changed = vi.fn(); fixture.componentInstance.selected.subscribe(changed);
    const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toContain('Sleep duration source: Suunto');
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const options = overlay.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(options).toHaveLength(2); expect(options[0].getAttribute('aria-checked')).toBe('true');
    expect(overlay.textContent).toContain('Provider calculated');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    options[1].click(); fixture.detectChanges(); await fixture.whenStable();
    expect(changed).toHaveBeenCalledExactlyOnceWith('1');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.componentInstance.choose('0'); fixture.componentInstance.choose('gone');
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('retains an unavailable saved reading and allows choosing the sole available replacement', () => {
    const fixture = create(choices.slice(0, 1), 'unavailable');
    expect(fixture.componentInstance.label()).toBe('Source unavailable');
    expect(fixture.nativeElement.querySelector('button')).not.toBeNull();
    const changed = vi.fn(); fixture.componentInstance.selected.subscribe(changed);
    fixture.componentInstance.choose('0'); expect(changed).toHaveBeenCalledExactlyOnceWith('0');
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    fixture.componentInstance.choose('0'); expect(changed).toHaveBeenCalledTimes(1);
  });
  it('closes an open picker when choices disappear, without background feedback', async () => {
    const fixture = create(); fixture.nativeElement.querySelector('button').click(); fixture.detectChanges(); await fixture.whenStable();
    fixture.componentRef.setInput('choices', []); fixture.detectChanges(); await fixture.whenStable();
    expect(TestBed.inject(OverlayContainer).getContainerElement().querySelector('[role="menu"]')).toBeNull();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });
});
