import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppWindowService } from '../../../services/app.window.service';
import { LoggerService } from '../../../services/logger.service';
import { DeferredLoadErrorComponent } from './deferred-load-error.component';
import type { DeferredLoadArea } from '../../../helpers/deferred-load.helper';

describe('deferred-load recovery', () => {
  const reload = vi.fn(), selection = vi.fn(), error = vi.fn(), captureMessage = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ imports: [DeferredLoadErrorComponent], providers: [
      { provide: AppWindowService, useValue: { windowRef: { location: { reload } } } },
      { provide: AppHapticsService, useValue: { selection, error } },
      { provide: LoggerService, useValue: { captureMessage } },
    ] });
  });
  afterEach(() => vi.useRealTimers());

  function render(area: DeferredLoadArea = 'navigation') {
    const fixture = TestBed.createComponent(DeferredLoadErrorComponent);
    fixture.componentRef.setInput('area', area); fixture.detectChanges();
    return fixture;
  }

  it('renders accessible recovery and safe diagnostics without reloading or haptics on initialization', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain("Navigation couldn't load");
    expect(fixture.nativeElement.textContent).toContain('Unsaved changes may be lost');
    expect(fixture.nativeElement.querySelector('button').textContent.trim()).toBe('Reload page');
    expect(captureMessage).toHaveBeenCalledExactlyOnceWith('Deferred content failed to load', {
      level: 'warning', fingerprint: ['deferred-load', 'navigation'], tags: { operation: 'deferred-load', area: 'navigation' },
    });
    expect(reload).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('deduplicates repeated failures of the same area, while identifying a different failed preview', () => {
    render().destroy(); render().destroy(); render('health-overview');
    expect(captureMessage).toHaveBeenCalledTimes(2);
    expect(captureMessage.mock.calls[1][1].tags.area).toBe('health-overview');
  });
  it('keeps controls usable when telemetry fails and never reports arbitrary area strings', () => {
    captureMessage.mockImplementationOnce(() => { throw Error('telemetry unavailable'); });
    expect(render().nativeElement.querySelector('button').disabled).toBe(false);
    const invalid = render('/users/private-id' as DeferredLoadArea);
    expect(invalid.nativeElement.textContent).toContain("Content couldn't load");
    expect(invalid.nativeElement.textContent).not.toContain('private-id'); expect(captureMessage).toHaveBeenCalledOnce();
  });
  it('reloads only on explicit action, prevents double dispatch and permits retry after cancelled navigation', async () => {
    vi.useFakeTimers();
    const fixture = render(), button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click(); fixture.detectChanges();
    expect(reload).toHaveBeenCalledOnce(); expect(selection).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true); expect(button.getAttribute('aria-busy')).toBe('true');
    fixture.componentInstance.reload(); expect(reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000); fixture.detectChanges();
    expect(button.disabled).toBe(false); expect(reload).toHaveBeenCalledOnce();
    button.click(); expect(reload).toHaveBeenCalledTimes(2); expect(selection).toHaveBeenCalledTimes(2);
    fixture.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('recovers a blocked reload with one failure feedback and a browser-reload explanation', () => {
    vi.useFakeTimers(); reload.mockImplementationOnce(() => { throw Error('navigation blocked'); });
    const fixture = render(), button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click(); fixture.detectChanges();
    expect(reload).toHaveBeenCalledOnce(); expect(selection).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false); expect(fixture.nativeElement.textContent).toContain('Use your browser\'s reload control');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not emit browser telemetry or navigate during server rendering', () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    const fixture = render(); fixture.componentInstance.reload();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
    expect(captureMessage).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
  });
});
