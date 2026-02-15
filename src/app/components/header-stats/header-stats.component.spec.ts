import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import {
  DataHeartRateAvg,
  DataHeartRateMax,
  DataHeartRateMin,
  DataPowerAvg,
  DataPowerMax,
  DataPowerMin,
  DataSpeedAvgKilometersPerHour,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderStatsComponent } from './header-stats.component';

const createStat = (type: string, displayType: string, displayValue: string, displayUnit = '') => {
  return {
    getType: () => type,
    getDisplayType: () => displayType,
    getDisplayValue: () => displayValue,
    getDisplayUnit: () => displayUnit,
  } as any;
};

describe('HeaderStatsComponent', () => {
  let component: HeaderStatsComponent;
  let fixture: ComponentFixture<HeaderStatsComponent>;

  const applyChanges = (componentToUpdate: HeaderStatsComponent) => {
    componentToUpdate.ngOnChanges({
      statsToShow: new SimpleChange(null, componentToUpdate.statsToShow, true),
      stats: new SimpleChange(null, componentToUpdate.stats, true),
      layout: new SimpleChange(null, componentToUpdate.layout, true),
      unitSettings: new SimpleChange(null, componentToUpdate.unitSettings, true),
      showDiff: new SimpleChange(null, componentToUpdate.showDiff, true),
      diffByType: new SimpleChange(null, componentToUpdate.diffByType, true),
      singleValueTypes: new SimpleChange(null, componentToUpdate.singleValueTypes, true),
    });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockImplementation((stat: any) => [stat]);

    await TestBed.configureTestingModule({
      declarations: [HeaderStatsComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderStatsComponent);
    component = fixture.componentInstance;
    component.unitSettings = {} as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should combine avg/min/max into one grid card', () => {
    component.layout = 'grid';
    component.statsToShow = [DataPowerAvg.type];
    component.stats = [
      createStat(DataPowerAvg.type, 'Average Power', '250', 'W'),
      createStat(DataPowerMin.type, 'Minimum Power', '120', 'W'),
      createStat(DataPowerMax.type, 'Maximum Power', '680', 'W'),
    ];

    applyChanges(component);

    expect(component.displayedStatCards.length).toBe(1);
    expect(component.displayedStatCards[0].label).toBe('Power');
    expect(component.displayedStatCards[0].valueItems.map(item => item.type)).toEqual([
      DataPowerAvg.type,
      DataPowerMin.type,
      DataPowerMax.type,
    ]);
  });

  it('should pull full family when only one family member is requested', () => {
    component.layout = 'grid';
    component.statsToShow = [DataPowerMin.type];
    component.stats = [
      createStat(DataPowerAvg.type, 'Average Power', '250', 'W'),
      createStat(DataPowerMin.type, 'Minimum Power', '120', 'W'),
      createStat(DataPowerMax.type, 'Maximum Power', '680', 'W'),
    ];

    applyChanges(component);

    expect(component.displayedStatCards.length).toBe(1);
    expect(component.displayedStatCards[0].valueItems.map(item => item.key)).toEqual(['AVG', 'MIN', 'MAX']);
  });

  it('should render only available family values when one is missing', () => {
    component.layout = 'grid';
    component.statsToShow = [DataPowerAvg.type];
    component.stats = [
      createStat(DataPowerAvg.type, 'Average Power', '250', 'W'),
      createStat(DataPowerMax.type, 'Maximum Power', '680', 'W'),
    ];

    applyChanges(component);

    expect(component.displayedStatCards.length).toBe(1);
    expect(component.displayedStatCards[0].valueItems.map(item => item.key)).toEqual(['AVG', 'MAX']);
  });

  it('should provide diff for each composite row when present', () => {
    component.layout = 'grid';
    component.showDiff = true;
    component.diffByType = new Map([
      [DataPowerAvg.type, { display: '10 W', percent: 4.0, color: '#0f0' }],
      [DataPowerMin.type, { display: '5 W', percent: 2.0, color: '#0f0' }],
      [DataPowerMax.type, { display: '20 W', percent: 3.0, color: '#0f0' }],
    ]);
    component.statsToShow = [DataPowerAvg.type];
    component.stats = [
      createStat(DataPowerAvg.type, 'Average Power', '250', 'W'),
      createStat(DataPowerMin.type, 'Minimum Power', '120', 'W'),
      createStat(DataPowerMax.type, 'Maximum Power', '680', 'W'),
    ];

    applyChanges(component);

    const card = component.displayedStatCards[0];
    card.valueItems.forEach((item) => {
      expect(component.getDiffForType(item.type)).toBeTruthy();
    });
  });

  it('should keep condensed mode stat expansion unchanged', () => {
    component.layout = 'condensed';
    component.statsToShow = [DataPowerAvg.type];
    component.stats = [
      createStat(DataPowerAvg.type, 'Average Power', '250', 'W'),
      createStat(DataPowerMin.type, 'Minimum Power', '120', 'W'),
      createStat(DataPowerMax.type, 'Maximum Power', '680', 'W'),
    ];

    applyChanges(component);

    expect(component.displayedStats.map(stat => stat.getType())).toEqual([DataPowerAvg.type]);
  });

  it('should keep configured single-value types as single cards', () => {
    component.layout = 'grid';
    component.singleValueTypes = [DataHeartRateAvg.type];
    component.statsToShow = [DataHeartRateAvg.type];
    component.stats = [
      createStat(DataHeartRateAvg.type, 'Average Heart Rate', '152', 'bpm'),
      createStat(DataHeartRateMin.type, 'Minimum Heart Rate', '98', 'bpm'),
      createStat(DataHeartRateMax.type, 'Maximum Heart Rate', '183', 'bpm'),
    ];

    applyChanges(component);

    expect(component.displayedStatCards.length).toBe(1);
    expect(component.displayedStatCards[0].isComposite).toBe(false);
    expect(component.displayedStatCards[0].valueItems.map(item => item.type)).toEqual([DataHeartRateAvg.type]);
  });

  it('should normalize unit-derived labels while keeping non-unit labels unchanged', () => {
    const derived = createStat(
      DataSpeedAvgKilometersPerHour.type,
      'Average speed in kilometers per hour',
      '31',
      'km/h'
    );
    const nonDerived = createStat(DataPowerAvg.type, 'Average Power', '250', 'W');

    expect(component.getNormalizedStatLabel(derived)).toBe('Average Speed');
    expect(component.getNormalizedStatLabel(nonDerived)).toBe('Average Power');
  });

  it('should hide NaN values from cards and remove single-value cards that only contain NaN', () => {
    component.layout = 'grid';
    component.statsToShow = [DataPowerAvg.type, DataHeartRateAvg.type];
    component.stats = [
      createStat(DataPowerAvg.type, 'Average Power', 'NaN', 'W'),
      createStat(DataPowerMin.type, 'Minimum Power', '120', 'W'),
      createStat(DataPowerMax.type, 'Maximum Power', '680', 'W'),
      createStat(DataHeartRateAvg.type, 'Average Heart Rate', 'NaN', 'bpm'),
    ];

    applyChanges(component);

    expect(component.displayedStatCards.length).toBe(1);
    expect(component.displayedStatCards[0].label).toBe('Power');
    expect(component.displayedStatCards[0].valueItems.map(item => item.key)).toEqual(['MIN', 'MAX']);
  });

  it('should hide NaN diffs for display and composite visibility checks', () => {
    component.layout = 'grid';
    component.showDiff = true;
    component.diffByType = new Map([
      [DataPowerAvg.type, { display: 'NaN', percent: NaN, color: '#0f0' }],
      [DataPowerMin.type, { display: '5 W', percent: 2, color: '#0f0' }],
    ]);
    component.statsToShow = [DataPowerAvg.type];
    component.stats = [
      createStat(DataPowerAvg.type, 'Average Power', '250', 'W'),
      createStat(DataPowerMin.type, 'Minimum Power', '120', 'W'),
      createStat(DataPowerMax.type, 'Maximum Power', '680', 'W'),
    ];

    applyChanges(component);

    const card = component.displayedStatCards[0];
    expect(component.getDiffForType(DataPowerAvg.type)).toBeNull();
    expect(component.getDiffForType(DataPowerMin.type)).toBeTruthy();
    expect(component.hasCompositeDiff(card)).toBe(true);
  });

  it('should strip trailing units from composite delta display', () => {
    expect(component.getCompositeDeltaDisplay('10 W', 'W')).toBe('10');
    expect(component.getCompositeDeltaDisplay('10w', 'W')).toBe('10');
    expect(component.getCompositeDeltaDisplay('10', 'W')).toBe('10');
  });

});
