import { TestBed } from '@angular/core/testing';
import { BenchmarkReportComponent } from './benchmark-report.component';
import { BenchmarkResult } from '@shared/app-event.interface';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { BenchmarkReviewService } from '../../services/benchmark-review.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { SimpleChange } from '@angular/core';
import {
    EventImporterJSON, ActivityTypes, DataRRRMSSD, DataRRCoverage, DataRRArtifactPercentage,
    DataRRArtifactCount, DataRRSDNN, DataRRPNN50, DataRRDFAAlpha1Median,
    DataRRSuspectedEctopicPairCount, DataDistance, DistanceUnits,
    type ActivityInterface, type DataInterface, type EventInterface,
} from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';

function rrRecording(id: string, stats: DataInterface[] = []): ActivityInterface {
    const activity = EventImporterJSON.getActivityFromJSON({
        name: '', startDate: 0, endDate: 10000, type: ActivityTypes.Running,
        creator: { name: id, devices: [] }, stats: {}, streams: [], laps: [], events: [], intensityZones: [],
    });
    activity.setID(id);
    activity.addStat(new DataDistance(1000));
    stats.forEach(stat => activity.addStat(stat));
    return activity;
}

function rrEvent(activities: ActivityInterface[]): EventInterface {
    return { getActivities: () => activities } as EventInterface;
}

describe('BenchmarkReportComponent', () => {
    let component: BenchmarkReportComponent;

    const createMockResult = (cep50: number, correlation: number): BenchmarkResult => ({
        referenceId: 'ref-id',
        testId: 'test-id',
        sourceEventId: 'source-event-id',
        timestamp: new Date(),
        metrics: {
            gnss: {
                cep50, cep95: cep50 * 2, rmse: cep50 * 1.5, maxDeviation: cep50 * 4,
                meanError: 0, medianError: 0, stdDevError: 0, minError: 0
            },
            streamMetrics: {
                HeartRate: {
                    pearsonCorrelation: correlation,
                    rootMeanSquareError: 3.5,
                    meanAbsoluteError: 2.1,
                    meanError: 0.2
                }
            }
        }
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [BenchmarkReportComponent],
            imports: [
                CommonModule, MatTooltipModule, MatIconModule
            ],
            providers: [
                {
                    provide: BenchmarkReviewService,
                    useValue: {
                        buildSummary: vi.fn(() => ({
                            title: 'Benchmark summary',
                            lines: [],
                            text: '',
                            atAGlanceItems: [
                                { key: 'overall', label: 'Overall', value: 'Excellent agreement' },
                            ],
                        })),
                    },
                },
                { provide: AppEventColorService, useValue: { getActivityColor: vi.fn(), getDifferenceColor: vi.fn() } },
            ]
        }).compileComponents();

        component = TestBed.runInInjectionContext(() => new BenchmarkReportComponent());
    });

    it.each([true, false])('renders GPS availability and the regeneration notice (missing GPS: %s)', missingGps => {
        const fixture = TestBed.createComponent(BenchmarkReportComponent);
        const report = { ...createMockResult(1, 0.99), requiresRegeneration: true, activityLinksResolved: false };
        if (missingGps) report.metrics.gnss = null;
        fixture.componentRef.setInput('result', report);
        fixture.detectChanges();
        const element: HTMLElement = fixture.nativeElement;
        expect(element.textContent).toContain('Regeneration required');
        expect(element.textContent).toContain('Choose the reference and test recordings again');
        expect(element.textContent?.includes('No shared GPS data')).toBe(missingGps);
        expect(!!element.querySelector('.gnss-card')).toBe(!missingGps);
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('excludes unavailable GPS from grades and insights', () => {
        component.result = createMockResult(0, 0.85);
        component.result.metrics.gnss = null;
        expect(component.getGnssGrade()).toBe('unavailable');
        expect(component.getOverallGrade()).toBe('poor');
        expect(component.getInsights()).toContainEqual({ label: 'No shared GPS data', grade: 'unavailable' });
        expect(component.getInsights().some(insight => insight.label.includes('GNSS accuracy'))).toBe(false);
    });

    it('excludes undefined correlation and handles an entirely ungraded report', () => {
        component.result = createMockResult(0, 0.99);
        component.result.metrics.gnss = null;
        component.result.metrics.streamMetrics.HeartRate.pearsonCorrelation = null;
        expect(component.getOverallGrade()).toBe('unavailable');
        expect(component.getStreamGrades()).toEqual([]);
        expect(component.getCorrelationLabel(null)).toBe('Correlation unavailable');
        expect(component.getInsights()).toEqual([{ label: 'No shared GPS data', grade: 'unavailable' }]);
    });

    it('marks historical reports for regeneration and skips current-stat differences', () => {
        component.result = { ...createMockResult(0, 1), requiresRegeneration: true, activityLinksResolved: false };
        component.diffChips = [{ label: 'Distance', hasDiff: true, absPercent: 0 }];
        component.ngOnChanges({ result: { currentValue: component.result, previousValue: null, firstChange: true, isFirstChange: () => true } });
        expect(component.getOverallGrade()).toBe('unavailable');
        expect(component.getVerdictTitle()).toBe('Regeneration required');
        expect(component.diffChips).toEqual([]);
    });

    describe('Grade Calculations', () => {
        it('should return excellent GNSS grade for CEP50 <= 2m', () => {
            component.result = createMockResult(1.5, 0.99);
            expect(component.getGnssGrade()).toBe('excellent');
        });

        it('should return good GNSS grade for CEP50 <= 5m', () => {
            component.result = createMockResult(3.5, 0.99);
            expect(component.getGnssGrade()).toBe('good');
        });

        it('should return fair GNSS grade for CEP50 <= 10m', () => {
            component.result = createMockResult(7.5, 0.99);
            expect(component.getGnssGrade()).toBe('fair');
        });

        it('should return poor GNSS grade for CEP50 > 10m', () => {
            component.result = createMockResult(15, 0.99);
            expect(component.getGnssGrade()).toBe('poor');
        });

        it('should return excellent correlation grade for >= 0.98', () => {
            expect(component.getCorrelationGrade(0.99)).toBe('excellent');
        });

        it('should return good correlation grade for >= 0.95', () => {
            expect(component.getCorrelationGrade(0.96)).toBe('good');
        });

        it('should return fair correlation grade for >= 0.90', () => {
            expect(component.getCorrelationGrade(0.92)).toBe('fair');
        });

        it('should return poor correlation grade for < 0.90', () => {
            expect(component.getCorrelationGrade(0.85)).toBe('poor');
        });
    });

    describe('Overall Grade', () => {
        it('should return excellent grade (>= 2.5) when all metrics are excellent (3)', () => {
            component.result = createMockResult(1.5, 0.99); // Excellent GNSS & Stream
            // 3 + 3 = 6 / 2 = 3.0 -> Excellent
            expect(component.getOverallGrade()).toBe('excellent');
        });

        it('should return good grade (>= 1.5) even with one poor metric if average is high enough', () => {
            // Setup: GNSS=Excellent (3), Stream=Poor (0). Avg = 1.5 -> Good
            // Current mock only has 1 stream. 
            // 3 (GNSS) + 0 (Correlation < 0.90) = 3 / 2 = 1.5 -> Good
            component.result = createMockResult(1.5, 0.85);
            expect(component.getOverallGrade()).toBe('good');
        });

        it('should return fair grade (>= 0.5) if metrics are mixed low', () => {
            // Setup: GNSS=Fair (1), Stream=Poor (0). Avg = 0.5 -> Fair
            // GNSS 7.5m -> Fair(1). Correlation 0.85 -> Poor(0).
            component.result = createMockResult(7.5, 0.85);
            expect(component.getOverallGrade()).toBe('fair');
        });

        it('should return poor grade (< 0.5) if all metrics are poor', () => {
            // Setup: GNSS=Poor (0), Stream=Poor (0). Avg=0 -> Poor
            component.result = createMockResult(15, 0.85);
            expect(component.getOverallGrade()).toBe('poor');
        });
    });

    describe('Grade Icons', () => {
        it('should return verified icon for excellent', () => {
            expect(component.getGradeIcon('excellent')).toBe('verified');
        });

        it('should return check_circle icon for good', () => {
            expect(component.getGradeIcon('good')).toBe('check_circle');
        });

        it('should return warning icon for fair', () => {
            expect(component.getGradeIcon('fair')).toBe('warning');
        });

        it('should return error icon for poor', () => {
            expect(component.getGradeIcon('poor')).toBe('error');
        });
    });

    describe('Insights', () => {
        it('should generate insights for GNSS and streams', () => {
            component.result = createMockResult(1.5, 0.99);
            const insights = component.getInsights();

            expect(insights.length).toBe(2); // GNSS + HeartRate
            expect(insights[0].label).toContain('GNSS');
            expect(insights[1].label).toContain('HeartRate');
        });
    });

    it('updates reviewer summary at a glance items from tags', () => {
        component.result = createMockResult(1.5, 0.99);
        component.benchmarkReviewTags = ['firmware'];

        component.ngOnChanges({
            result: {} as any,
            benchmarkReviewTags: {} as any,
        });

        const reviewService = TestBed.inject(BenchmarkReviewService) as unknown as { buildSummary: ReturnType<typeof vi.fn> };
        expect(reviewService.buildSummary).toHaveBeenCalledWith(component.result, ['firmware']);
        expect(component.atAGlanceItems).toEqual([
            { key: 'overall', label: 'Overall', value: 'Excellent agreement' },
        ]);
        expect(component.reviewerSummaryGrade).toBe('excellent');
    });

    describe('R–R and HRV report section', () => {
        it.each([false, true])('renders the selected pair, quality context and neutral differences in the exportable report (imperial: %s)', imperial => {
            const reference = rrRecording('ref-id', [
                new DataRRCoverage(100), new DataRRArtifactPercentage(0), new DataRRArtifactCount(0),
                new DataRRSuspectedEctopicPairCount(0), new DataRRRMSSD(20), new DataRRSDNN(30),
                new DataRRPNN50(10), new DataRRDFAAlpha1Median(.62),
            ]);
            const test = rrRecording('test-id', [new DataRRRMSSD(30)]);
            const unrelated = rrRecording('other-id', [new DataRRRMSSD(999)]);
            const fixture = TestBed.createComponent(BenchmarkReportComponent);
            fixture.componentRef.setInput('result', { ...createMockResult(1, .99), referenceName: 'Strap', testName: 'Watch' });
            fixture.componentRef.setInput('event', rrEvent([test, unrelated, reference]));
            fixture.componentRef.setInput('unitSettings', {
                ...getDefaultUserUnitSettings(), distanceUnits: imperial ? DistanceUnits.Miles : DistanceUnits.Kilometers,
            });
            fixture.detectChanges();
            const root: HTMLElement = fixture.nativeElement;
            const section = root.querySelector('.benchmark-container .rr-summary-card');
            expect(section?.textContent).toContain('R–R & HRV');
            expect(section?.textContent).toContain('excluded from the agreement grade');
            expect(section?.textContent).toContain('Strap'); expect(section?.textContent).toContain('Watch');
            expect(section?.textContent).toContain('0 flagged intervals');
            expect(section?.querySelectorAll('tbody tr')).toHaveLength(7);
            const row = Array.from(section!.querySelectorAll('tbody tr')).find(element => element.textContent?.includes('RMSSD'))!;
            expect(Array.from(row.querySelectorAll('.rr-recording-value')).map(element => element.textContent?.trim()))
                .toEqual(['20.0 ms', '30.0 ms']);
            expect(row.textContent).toContain('10.0 ms'); expect(row.textContent).toContain('40.0%');
            expect(section?.textContent).not.toContain('999');
            expect(root.querySelector('.rr-table-region')?.getAttribute('tabindex')).toBe('0');
        });

        it('keeps recorded zero visible when the other recording has no HRV and excludes R–R from agreement chips', () => {
            component.result = createMockResult(1, .99);
            component.event = rrEvent([
                rrRecording('ref-id', [new DataRRRMSSD(0)]), rrRecording('test-id'),
            ]);
            component.unitSettings = getDefaultUserUnitSettings();
            component.ngOnChanges({ result: new SimpleChange(null, component.result, true) });
            expect(component.rrRows).toHaveLength(1);
            expect(component.rrRows[0].cells).toEqual([{ display: '0.0 ms', detail: null }, { display: null, detail: null }]);
            expect(component.rrRows[0].difference).toBeNull();
            expect(component.diffChips.some(chip => /RMSSD|R–R|R-R/.test(chip.label))).toBe(false);
            expect(component.getOverallGrade()).toBe('excellent');
        });

        it('does not use HRV differences to change the hardware agreement grade', () => {
            component.result = createMockResult(1, .99);
            component.event = rrEvent([
                rrRecording('ref-id', [new DataRRRMSSD(1)]), rrRecording('test-id', [new DataRRRMSSD(100)]),
            ]);
            component.unitSettings = getDefaultUserUnitSettings();
            component.ngOnChanges({ result: new SimpleChange(null, component.result, true) });
            expect(component.rrRows[0].difference?.percent).toBeGreaterThan(190);
            expect(component.diffChips.some(chip => /RMSSD|R–R|R-R/.test(chip.label))).toBe(false);
            expect(component.getOverallGrade()).toBe('excellent');
        });

        it.each([
            'missing-stats', 'missing-participant', 'duplicate-participant', 'same-participant', 'stale', 'unresolved-links', 'missing-event',
        ])('omits the section when the report cannot safely show saved R–R values: %s', scenario => {
            component.result = createMockResult(1, .99);
            const reference = rrRecording('ref-id', scenario === 'missing-stats' ? [] : [new DataRRRMSSD(20)]);
            const test = rrRecording(scenario === 'missing-participant' ? 'other-id' : 'test-id');
            component.event = rrEvent(scenario === 'duplicate-participant' ? [reference, reference, test] : [reference, test]);
            if (scenario === 'same-participant') component.result.testId = component.result.referenceId;
            if (scenario === 'stale') component.result.requiresRegeneration = true;
            if (scenario === 'unresolved-links') component.result.activityLinksResolved = false;
            if (scenario === 'missing-event') component.event = undefined;
            component.ngOnChanges({ result: new SimpleChange(null, component.result, true) });
            expect(component.rrRows).toEqual([]);
        });

        it('clears previous recording values when the report changes to an unmatched pair', () => {
            component.result = createMockResult(1, .99);
            component.event = rrEvent([rrRecording('ref-id', [new DataRRRMSSD(20)]), rrRecording('test-id')]);
            component.ngOnChanges({ result: new SimpleChange(null, component.result, true) });
            expect(component.rrRows).toHaveLength(1);
            const previous = component.result;
            component.result = { ...previous, testId: 'unknown-test' };
            component.ngOnChanges({ result: new SimpleChange(previous, component.result, false) });
            expect(component.rrRows).toEqual([]);
        });
    });
});
