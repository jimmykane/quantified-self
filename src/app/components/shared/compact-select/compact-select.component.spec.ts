import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { CompactSelectComponent } from './compact-select.component';
import { AppHapticsService } from '../../../services/app.haptics.service';

async function setup() {
  const haptics = { selection: vi.fn() };
  await TestBed.configureTestingModule({ imports: [CompactSelectComponent, NoopAnimationsModule],
    providers: [{ provide: AppHapticsService, useValue: haptics }] }).compileComponents();
  const fixture = TestBed.createComponent(CompactSelectComponent);
  fixture.componentRef.setInput('label', 'Linked plan'); fixture.componentRef.setInput('value', null);
  fixture.componentRef.setInput('options', [{ value: null, label: 'Independent goal' },
    { value: 'plan', label: 'A long training plan name that wraps on a phone' }, { value: 'disabled', label: 'Unavailable', disabled: true }]);
  const changed = vi.fn(value => fixture.componentRef.setInput('value', value));
  fixture.componentInstance.selectionChange.subscribe(changed);
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  await settle();
  const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  const overlay = TestBed.inject(OverlayContainer).getContainerElement();
  const choices = () => Array.from(overlay.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
  return { fixture, trigger, overlay, choices, changed, haptics, settle };
}
describe('compact select', () => {
  it('labels the current choice, marks it and returns focus after one accepted change', async () => {
    const c = await setup(); expect(c.haptics.selection).not.toHaveBeenCalled();
    expect(c.trigger.getAttribute('aria-label')).toBe('Linked plan: Independent goal');
    c.trigger.click(); await c.settle();
    expect(c.overlay.querySelector('.qs-menu-panel')).not.toBeNull();
    expect(c.choices().map(item => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(c.choices()[0].querySelector('mat-icon')?.textContent).toBe('check');
    c.choices()[1].click(); await c.settle();
    expect(c.changed).toHaveBeenCalledExactlyOnceWith('plan');
    expect(document.activeElement).toBe(c.trigger); expect(c.trigger.textContent).toContain('A long training plan name');
    expect(c.haptics.selection).toHaveBeenCalledOnce();
    c.trigger.click(); await c.settle(); c.choices()[1].click(); await c.settle();
    expect(c.changed).toHaveBeenCalledOnce();
  });
  it('keeps disabled, stale and unknown selections inert, including an already open menu', async () => {
    const c = await setup(); c.trigger.click(); await c.settle();
    c.choices()[2].click(); c.fixture.componentInstance.select('unknown'); expect(c.changed).not.toHaveBeenCalled();
    c.fixture.componentRef.setInput('disabled', true); await c.settle();
    expect(c.choices().every(choice => choice.disabled)).toBe(true);
    c.fixture.componentInstance.select('plan'); expect(c.changed).not.toHaveBeenCalled();
    expect(c.trigger.disabled).toBe(true); expect(c.haptics.selection).toHaveBeenCalledOnce();
  });
  it('closes with Escape and restores focus without changing the selected value', async () => {
    const c = await setup(); c.trigger.click(); await c.settle();
    c.overlay.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await c.settle(); expect(c.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(c.trigger); expect(c.changed).not.toHaveBeenCalled();
    expect(c.haptics.selection).toHaveBeenCalledOnce();
  });
});
