import { TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { HEALTH_PROVIDERS } from '@shared/health';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HealthViewOptionsBottomSheetComponent, type HealthViewOptionsData } from './health-view-options-bottom-sheet.component';

describe('HealthViewOptionsBottomSheetComponent', () => {
  const garmin = HEALTH_PROVIDERS.GarminAPI;
  const suunto = HEALTH_PROVIDERS.SuuntoApp;
  const initial: HealthViewOptionsData = {
    range: '30d',
    ranges: [
      { range: 'today', label: '1 day', buttonLabel: '1d' },
      { range: '14d', label: '14 days', buttonLabel: '14d' },
      { range: '30d', label: '30 days', buttonLabel: '30d' },
      { range: '90d', label: '90 days', buttonLabel: '90d' },
      { range: '1y', label: '1 year', buttonLabel: '1y' },
    ],
    providers: [{ provider: garmin, label: 'Garmin', selected: true }, { provider: suunto, label: 'Suunto', selected: true }],
    sourcesLoading: false,
  };

  async function create(data = initial) {
    const dismiss = vi.fn();
    const haptics = { selection: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [HealthViewOptionsBottomSheetComponent],
      providers: [
        { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
        { provide: MatBottomSheetRef, useValue: { dismiss } },
        { provide: AppHapticsService, useValue: haptics },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HealthViewOptionsBottomSheetComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, dismiss, haptics };
  }

  it('keeps range/source edits as a draft until Apply and does not mutate its input', async () => {
    const { component, dismiss, haptics, fixture } = await create();
    expect(haptics.selection).not.toHaveBeenCalled();
    component.selectRange('30d');
    component.selectAll(true);
    component.selectProvider(garmin, true);
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button[aria-label="14 days"]').click();
    component.selectProvider(garmin, false);
    fixture.detectChanges();
    expect(component.partlySelected()).toBe(true);
    expect(dismiss).not.toHaveBeenCalled();
    expect(initial.range).toBe('30d');
    expect(initial.providers.every(provider => provider.selected)).toBe(true);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ range: '14d', providers: [suunto] });
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('cancels without applying a pending change', async () => {
    const { component, dismiss, haptics, fixture } = await create();
    component.selectRange('14d');
    fixture.nativeElement.querySelector('[aria-label="Close view options"]').click();
    expect(dismiss).toHaveBeenCalledWith();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('prevents an empty selection and preserves the original selection when edits are reverted', async () => {
    const { component, fixture, dismiss } = await create();
    component.selectAll(false);
    fixture.detectChanges();
    expect(component.canApply()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Choose at least one source.');
    component.apply();
    expect(dismiss).not.toHaveBeenCalled();
    component.selectAll(true);
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ range: '30d', providers: null });
  });

  it('returns All sources explicitly when changing from a provider subset', async () => {
    const { component, dismiss } = await create({
      ...initial,
      providers: [initial.providers[0], { ...initial.providers[1], selected: false }],
    });
    component.selectAll(true);
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ range: '30d', providers: [] });
  });

  it('preserves source selection for range-only edits from a provider subset', async () => {
    const { component, dismiss } = await create({
      ...initial,
      providers: [initial.providers[0], { ...initial.providers[1], selected: false }],
    });
    component.selectRange('14d');
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ range: '14d', providers: null });
  });

  it('shows a single source as attribution, not redundant choices', async () => {
    const { fixture, component, dismiss } = await create({ ...initial, providers: [initial.providers[0]] });
    expect(fixture.nativeElement.querySelectorAll('mat-checkbox')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.health-view-options-single-source').textContent).toBe('Garmin');
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ range: '30d', providers: null });
  });

  it('allows range changes while loading without clearing existing source filters', async () => {
    const { component, fixture, dismiss, haptics } = await create({ ...initial, sourcesLoading: true, providers: [] });
    expect(fixture.nativeElement.textContent).toContain('Sources are loading');
    component.selectProvider(garmin, true);
    component.selectAll(true);
    expect(haptics.selection).not.toHaveBeenCalled();
    component.selectRange('today');
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ range: 'today', providers: null });
  });

  it('keeps range selection available in a data-free window', async () => {
    const { component, fixture, dismiss } = await create({ ...initial, providers: [] });
    expect(fixture.nativeElement.textContent).toContain('No sources in this window');
    expect(component.canApply()).toBe(true);
    component.selectRange('1y');
    component.apply();
    expect(dismiss).toHaveBeenCalledWith({ range: '1y', providers: null });
  });
});
