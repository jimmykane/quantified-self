import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BenchmarkReportComponent } from './benchmark-report.component';
import { BenchmarkResult } from '../../../../functions/src/shared/app-event.interface';
import { describe, it, expect, beforeEach } from 'vitest';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

describe('BenchmarkReportComponent', () => {
    let component: BenchmarkReportComponent;
    let fixture: ComponentFixture<BenchmarkReportComponent>;

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
                MatCardModule,
                MatIconModule
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(BenchmarkReportComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
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
});
