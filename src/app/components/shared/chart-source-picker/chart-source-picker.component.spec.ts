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
    fixture.componentRef.setInput('chartTitle', options.some(option => option.readingKey) ? 'Heart rate' : 'Sleep duration'); fixture.detectChanges(); return fixture;
  }
  it('chooses a measurement first and offers only matching providers in its source menu', async () => {
    const daytime = choices.map(choice => ({ ...choice, readingKey: 'daytime', readingLabel: 'Throughout the day', readingMethod: 'Recorded intervals' }));
    const fixture = create([...daytime, { ...choices[0], key: 'sleep', readingKey: 'sleep-average', readingLabel: 'Average sleep HR' }]);
    const changed = vi.fn(); fixture.componentInstance.selected.subscribe(changed);
    const measurement = fixture.nativeElement.querySelector('[aria-label^="Heart rate measurement:"]');
    expect(measurement?.textContent).toContain('Throughout the day');
    expect(fixture.componentInstance.sourceChoices().map(choice => choice.key)).toEqual(['0', '1']);
    const sourceTrigger = fixture.nativeElement.querySelector('.chart-source-row button');
    expect(measurement.compareDocumentPosition(sourceTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    sourceTrigger.click(); fixture.detectChanges(); await fixture.whenStable();
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
    expect(fixture.nativeElement.querySelector('[aria-label^="Heart rate measurement:"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.chart-source-row button')?.getAttribute('aria-label')).toContain('Suunto');
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentRef.setInput('choices', daytime.map(choice => ({ ...choice, readingMethod: 'Calculated by QS' })));
    fixture.componentRef.setInput('compact', false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-reading-method')?.textContent).toBe('Daily average · Calculated by QS');
    expect(fixture.componentInstance.choice()?.readingMethod).toBe('Calculated by QS');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('shows attribution without a redundant control when only one reading is available', () => {
    const fixture = create(choices.slice(0, 1));
    expect(fixture.nativeElement.textContent).toContain('Suunto · Main sleep');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('leads with Heart rate and sleep average while retaining a saved secondary selection in More measurements', async () => {
    const options = [
      { ...choices[0], key: 'day', readingKey: 'daytime', readingLabel: 'Heart rate' },
      { ...choices[0], key: 'sleep', readingKey: 'sleep-average', readingLabel: 'Average sleep HR' },
      { ...choices[0], key: 'minimum', readingKey: 'sleep-minimum', readingLabel: 'Minimum sleep HR', secondaryMeasurement: true },
      { ...choices[0], key: 'rolling', readingKey: 'rolling-average', readingLabel: '7-day average HR', secondaryMeasurement: true },
    ];
    const fixture = create(options, 'minimum'), changed = vi.fn();
    fixture.componentInstance.selected.subscribe(changed);
    const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-label^="Heart rate measurement:"]')!;
    expect(trigger.textContent).toContain('Minimum sleep HR');
    expect(haptics.selection).not.toHaveBeenCalled();
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(Array.from(overlay.querySelectorAll('[role="menuitemradio"]')).map(item => item.getAttribute('aria-label'))).toEqual(['Heart rate', 'Average sleep HR']);
    expect(overlay.textContent).not.toContain('Minimum sleep HR');
    const more = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('More measurements'))!;
    more.click(); fixture.detectChanges(); await fixture.whenStable();
    const minimum = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(button => button.textContent?.includes('Minimum sleep HR'))!;
    expect(minimum.getAttribute('aria-checked')).toBe('true');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    const rolling = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(button => button.textContent?.includes('7-day average HR'))!;
    rolling.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(changed).toHaveBeenCalledExactlyOnceWith('rolling');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    fixture.componentRef.setInput('selectedKey', 'rolling'); fixture.detectChanges();
    expect(trigger.textContent).toContain('7-day average HR');
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    fixture.componentInstance.chooseMeasurement('daytime');
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('keeps secondary-only recordings directly available when no primary measurement exists', () => {
    const fixture = create(choices.map((choice, index) => ({ ...choice, readingKey: `${index}`, readingLabel: `Other ${index}`, secondaryMeasurement: true })));
    expect(fixture.componentInstance.primaryMeasurements()).toHaveLength(2);
    expect(fixture.componentInstance.secondaryMeasurements()).toHaveLength(0);
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
