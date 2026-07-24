import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  DataThreeDimensionalStrainEvidence,
  type ActivityInterface,
  type ThreeDimensionalStrainEvidenceValue,
} from '@sports-alliance/sports-lib';
import { EventPowerSystemStrainComponent } from './event.power-system-strain.component';

function readyEvidence(): ThreeDimensionalStrainEvidenceValue {
  return {
    protocolVersion: 2,
    sourceFingerprint: 'three-dimensional-strain-v2:0000000000000001',
    activityType: ActivityTypes.Rowing,
    activityGroup: ActivityTypeGroups.WaterSportsGroup,
    eligibility: { eligible: true, reason: 'eligible' },
    input: {
      powerSampleCount: 3_600,
      validPowerSampleCount: 3_600,
      candidateDurationSeconds: 3_600,
      recordedDurationSeconds: 3_600,
      coverageRatio: 1,
      curvePointCount: 9,
      hasShortDuration: true,
      hasMediumDuration: true,
      hasLongDuration: true,
    },
    fit: {
      criticalPowerWatts: 250,
      wPrimeJoules: 20_000,
      maximumPowerWatts: 1_050,
      sampleCount: 9,
      rmseWatts: 4,
      normalizedRmse: 0.02,
      rSquared: 0.98,
      iterations: 24,
      converged: true,
    },
    evidence: {
      total: 12,
      criticalPower: 7,
      wPrime: 3,
      maximumPower: 2,
      endingWPrimeBalanceJoules: 15_000,
      minimumWPrimeBalanceJoules: 12_000,
    },
  };
}

function activity(value: ThreeDimensionalStrainEvidenceValue, id: string): ActivityInterface {
  return {
    type: value.protocolVersion === 2 ? value.activityType : ActivityTypes.Cycling,
    getID: () => id,
    getStat: (type: string) => type === DataThreeDimensionalStrainEvidence.type
      ? { getValue: () => value }
      : null,
  } as unknown as ActivityInterface;
}

describe('EventPowerSystemStrainComponent', () => {
  let fixture: ComponentFixture<EventPowerSystemStrainComponent>;
  let component: EventPowerSystemStrainComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EventPowerSystemStrainComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EventPowerSystemStrainComponent);
    component = fixture.componentInstance;
  });

  it('renders ready evidence for a non-running/cycling workout', () => {
    component.activities = [activity(readyEvidence(), 'rowing-1')];
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Power-system strain');
    expect(text).toContain(ActivityTypes.Rowing);
    expect(text).toContain('Total strain');
    expect(text).toContain('Fitted CP');
    expect(text).toContain('250 W');
    expect(text).toContain('This is not TSS, FTP, or a fitness score.');
  });

  it('renders selected workouts separately without combining their strain', () => {
    const second = {
      ...readyEvidence(),
      activityType: ActivityTypes.Sailing,
      sourceFingerprint: 'three-dimensional-strain-v2:0000000000000002',
    } as ThreeDimensionalStrainEvidenceValue;
    component.activities = [activity(readyEvidence(), 'rowing-1'), activity(second, 'sailing-1')];
    fixture.detectChanges();

    const workouts = Array.from(fixture.nativeElement.querySelectorAll('.power-system-strain-workout')) as HTMLElement[];

    expect(workouts).toHaveLength(2);
    expect(workouts[0].textContent).toContain(ActivityTypes.Rowing);
    expect(workouts[1].textContent).toContain(ActivityTypes.Sailing);
    expect(fixture.nativeElement.textContent).not.toContain('Combined');
  });

  it('explains unavailable evidence without a numeric strain score', () => {
    const unavailable = {
      ...readyEvidence(),
      eligibility: { eligible: false, reason: 'insufficient-coverage' },
      input: {
        ...readyEvidence().input,
        validPowerSampleCount: 2_000,
        recordedDurationSeconds: 2_000,
        coverageRatio: 2_000 / 3_600,
      },
      fit: null,
      evidence: null,
    } as ThreeDimensionalStrainEvidenceValue;
    component.activities = [activity(unavailable, 'rowing-1')];
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Unavailable');
    expect(text).toContain('Recorded power coverage was too incomplete for a reliable score.');
    expect(text).not.toContain('Total strain');
  });
});
