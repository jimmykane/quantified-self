import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { provideRouter } from '@angular/router';
import { HEALTH_PROVIDERS } from '@shared/health';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HealthSourcesBottomSheetComponent, type HealthSourcesData } from './health-sources-bottom-sheet.component';

describe('HealthSourcesBottomSheetComponent', () => {
  const garmin = HEALTH_PROVIDERS.GarminAPI;
  const suunto = HEALTH_PROVIDERS.SuuntoApp;
  const initial: HealthSourcesData = {
    providers: [
      { provider: garmin, label: 'Garmin', selected: true, presentation: null, hasDataInView: true, sync: null },
      { provider: suunto, label: 'Suunto', selected: true, presentation: null, hasDataInView: false, sync: {
        statusLabel: 'Current', statusTooltip: 'Source updated recently', lastUpdateText: '8 Sept, 08:32',
        lastUpdateDateTime: '2026-09-08T05:32:00.000Z', tone: 'current',
      } },
    ],
    syncStatus: 'ready',
  };
  async function create(data = initial) {
    const dismiss = vi.fn();
    const haptics = { selection: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [HealthSourcesBottomSheetComponent],
      providers: [provideRouter([]),
        { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
        { provide: MatBottomSheetRef, useValue: { dismiss } },
        { provide: AppHapticsService, useValue: haptics },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HealthSourcesBottomSheetComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, dismiss, haptics };
  }

  it('drafts source changes without changing the input or emitting hydration/no-op feedback', async () => {
    const { component, dismiss, haptics } = await create();
    component.selectAll(true);
    component.selectProvider(garmin, true);
    expect(haptics.selection).not.toHaveBeenCalled();
    component.selectProvider(garmin, false);
    expect(dismiss).not.toHaveBeenCalled();
    expect(initial.providers.every(provider => provider.selected)).toBe(true);
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ providers: [suunto] });
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('keeps statuses, timestamps and Connectivity in the sheet without date or import controls', async () => {
    const { fixture } = await create();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Highlights and every metric');
    expect(host.textContent).toContain('Current');
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-08T05:32:00.000Z');
    expect(host.querySelector('[data-tone="current"]')).not.toBeNull();
    expect(host.textContent).toContain('No readings in the current metric window');
    expect(host.querySelector('[routerlink="/services"]')).not.toBeNull();
    expect(host.querySelector('mat-button-toggle-group')).toBeNull();
    expect(host.textContent).not.toContain('Import history');
  });

  it('prevents empty selections and preserves an unchanged draft', async () => {
    const { component, fixture, dismiss } = await create();
    component.selectAll(false);
    fixture.detectChanges();
    expect(component.canApply()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Choose at least one source.');
    component.apply();
    expect(dismiss).not.toHaveBeenCalled();
    component.selectAll(true);
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ providers: null });
  });

  it('returns explicit All sources when changing from a subset', async () => {
    const { component, dismiss } = await create({ ...initial, providers: [initial.providers[0], { ...initial.providers[1], selected: false }] });
    component.selectAll(true);
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ providers: [] });
  });

  it('cancels without applying changes', async () => {
    const { component, dismiss, fixture } = await create();
    component.selectProvider(suunto, false);
    fixture.nativeElement.querySelector('[aria-label="Close sources"]').click();
    expect(dismiss).toHaveBeenCalledWith();
  });

  it('shows one source as attribution, including its status, instead of redundant checkboxes', async () => {
    const { fixture } = await create({ ...initial, providers: [initial.providers[1]] });
    expect(fixture.nativeElement.querySelectorAll('mat-checkbox')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.health-source-single').textContent).toContain('Current');
  });

  it.each(['loading', 'denied', 'error'] as const)('handles %s sync status without treating it as an empty source selection', async syncStatus => {
    const { fixture, component, dismiss } = await create({ providers: [], syncStatus });
    expect(fixture.nativeElement.querySelector('[role="status"], [role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[routerlink="/services"]')).not.toBeNull();
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ providers: null });
  });
});
