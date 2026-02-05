import { Component, Input } from '@angular/core';
import { BenchmarkResult } from '../../../../functions/src/shared/app-event.interface';

// Grade thresholds for GNSS accuracy (CEP50 in meters)
const GNSS_THRESHOLDS = {
    excellent: 2,
    good: 5,
    fair: 10
};

// Grade thresholds for correlation (0-1)
const CORRELATION_THRESHOLDS = {
    excellent: 0.98,
    good: 0.95,
    fair: 0.90
};

type Grade = 'excellent' | 'good' | 'fair' | 'poor';

@Component({
    selector: 'app-benchmark-report',
    template: `
    <div class="benchmark-container" *ngIf="result">
    
      <!-- Verdict Summary -->
      <mat-card class="verdict-card" [ngClass]="getOverallGrade()">
        <mat-card-header>
          <div mat-card-avatar class="grade-avatar" [ngClass]="getOverallGrade()">
            <mat-icon>{{ getGradeIcon(getOverallGrade()) }}</mat-icon>
          </div>
          <mat-card-title>{{ getVerdictTitle() }}</mat-card-title>
          <mat-card-subtitle>Hardware Benchmark Analysis</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <ul class="verdict-list">
            <li *ngFor="let insight of getInsights()">
              <mat-icon [ngClass]="insight.grade">{{ getGradeIcon(insight.grade) }}</mat-icon>
              <span>{{ insight.text }}</span>
            </li>
          </ul>
        </mat-card-content>
      </mat-card>

      <!-- Header -->
      <div class="report-header">
        <div class="device-pill" [style.--pill-color]="referenceColor || 'var(--mat-sys-primary)'">
           <mat-icon>star</mat-icon>
           <span>{{ result.referenceName || 'Device A' }}</span>
        </div>
        
        <div class="vs-badge">VS</div>
        
        <div class="device-pill" [style.--pill-color]="testColor || 'var(--mat-sys-tertiary)'">
           <mat-icon>watch</mat-icon>
           <span>{{ result.testName || 'Device B' }}</span>
        </div>

        <!-- Auto Align Status Chip -->
        <div class="align-chip" *ngIf="result.timeOffsetSeconds !== undefined" [matTooltip]="'Time alignment offset: ' + result.timeOffsetSeconds + 's'">
            <mat-icon>history</mat-icon>
            <span>Offset {{ result.timeOffsetSeconds }}s</span>
        </div>
      </div>

      <!-- GNSS Section -->
      <mat-card class="metric-card gnss-card">
        <mat-card-header>
            <div mat-card-avatar class="grade-avatar" [ngClass]="getGnssGrade()">
                <mat-icon>{{ getGradeIcon(getGnssGrade()) }}</mat-icon>
            </div>
            <mat-card-title>GNSS Accuracy</mat-card-title>
            <mat-card-subtitle>Positional Deviation</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content class="stats-grid">
            <div class="stat-item">
                <span class="label">CEP 50%</span>
                <span class="value">{{ result.metrics.gnss.cep50 | number:'1.2-2' }}m</span>
            </div>
            <div class="stat-item">
                <span class="label">CEP 95%</span>
                <span class="value">{{ result.metrics.gnss.cep95 | number:'1.2-2' }}m</span>
            </div>
            <div class="stat-item">
                <span class="label">RMSE</span>
                <span class="value">{{ result.metrics.gnss.rmse | number:'1.2-2' }}m</span>
            </div>
             <div class="stat-item">
                <span class="label">Max Dev</span>
                <span class="value highlight">{{ result.metrics.gnss.maxDeviation | number:'1.1-1' }}m</span>
            </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="metric-card info-card" *ngIf="result && (result.alignmentApplied || (result.qualityIssues && result.qualityIssues.length > 0))">
        <mat-card-header>
            <div mat-card-avatar class="grade-avatar">
                <mat-icon>tune</mat-icon>
            </div>
            <mat-card-title>Data Quality</mat-card-title>
            <mat-card-subtitle>Preprocessing & Artifacts</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
            <div class="quality-item" *ngIf="result.alignmentApplied">
                <mat-icon class="info-icon">schedule</mat-icon>
                <span>Auto-aligned by <strong>{{ result.timeOffsetSeconds }}s</strong> to maximize correlation.</span>
            </div>
            
            <div class="quality-issues-list qs-scrollbar" *ngIf="result.qualityIssues && result.qualityIssues.length > 0">
                <p class="issues-title">Detected Issues:</p>
                <div class="quality-issue" *ngFor="let issue of result.qualityIssues" [ngClass]="issue.severity">
                    <mat-icon>{{ getIssueIcon(issue.type) }}</mat-icon>
                    <div class="issue-details">
                        <span class="issue-desc">{{ issue.description }}</span>
                        <span class="issue-meta">{{ issue.streamType }} • {{ toSafeDate(issue.timestamp) | date:'mediumTime' }}</span>
                    </div>
                </div>
            </div>
        </mat-card-content>
      </mat-card>

      <div class="streams-container">
        <mat-card class="metric-card stream-card" *ngFor="let stream of objectKeys(result.metrics.streamMetrics)">
            <mat-card-header>
                <div mat-card-avatar class="grade-avatar" [ngClass]="getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)">
                    <mat-icon>{{ getGradeIcon(getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)) }}</mat-icon>
                </div>
                <mat-card-title>{{ stream }}</mat-card-title>
                <mat-card-subtitle>{{ getCorrelationLabel(result.metrics.streamMetrics[stream].pearsonCorrelation) }}</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <div class="correlation-meter">
                    <div class="bar-bg">
                        <div class="bar-fill" 
                             [style.width.%]="result.metrics.streamMetrics[stream].pearsonCorrelation * 100"
                             [ngClass]="getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)">
                        </div>
                    </div>
                    <span class="corr-value">
                        {{ result.metrics.streamMetrics[stream].pearsonCorrelation | number:'1.3-3' }} Correlation
                    </span>
                </div>
                <div class="mini-stats">
                    <span>RMSE: <span class="stat-val">{{ result.metrics.streamMetrics[stream].rootMeanSquareError | number:'1.1-1' }}</span></span>
                    <span>MAE: <span class="stat-val">{{ result.metrics.streamMetrics[stream].meanAbsoluteError | number:'1.1-1' }}</span></span>
                </div>
            </mat-card-content>
        </mat-card>
      </div>

    </div>
  `,
    styleUrls: ['./benchmark-report.component.css'],
    standalone: false
})
export class BenchmarkReportComponent {
    @Input() result: BenchmarkResult | null = null;
    @Input() referenceColor: string = '';
    @Input() testColor: string = '';
    objectKeys = Object.keys;

    getGnssGrade(): Grade {
        if (!this.result) return 'poor';
        const cep50 = this.result.metrics.gnss.cep50;
        if (cep50 <= GNSS_THRESHOLDS.excellent) return 'excellent';
        if (cep50 <= GNSS_THRESHOLDS.good) return 'good';
        if (cep50 <= GNSS_THRESHOLDS.fair) return 'fair';
        return 'poor';
    }

    getCorrelationGrade(correlation: number): Grade {
        if (correlation >= CORRELATION_THRESHOLDS.excellent) return 'excellent';
        if (correlation >= CORRELATION_THRESHOLDS.good) return 'good';
        if (correlation >= CORRELATION_THRESHOLDS.fair) return 'fair';
        return 'poor';
    }

    getOverallGrade(): Grade {
        const streamGrades = this.getStreamGrades();
        const gnssGrade = this.getGnssGrade();
        const allGrades = [gnssGrade, ...streamGrades];

        if (allGrades.length === 0) return 'fair';

        // Weighted scoring: Excellent=3, Good=2, Fair=1, Poor=0
        const scoreMap: Record<Grade, number> = { excellent: 3, good: 2, fair: 1, poor: 0 };
        const totalScore = allGrades.reduce((acc, g) => acc + scoreMap[g], 0);
        const average = totalScore / allGrades.length;

        // >= 2.5 (mostly excellent) -> Excellent
        // >= 1.5 (mostly good) -> Good
        // >= 0.5 (mostly fair) -> Fair
        // < 0.5 (mostly poor) -> Poor
        if (average >= 2.5) return 'excellent';
        if (average >= 1.5) return 'good';
        if (average >= 0.5) return 'fair';
        return 'poor';
    }

    getStreamGrades(): Grade[] {
        if (!this.result) return [];
        return Object.values(this.result.metrics.streamMetrics)
            .map(m => this.getCorrelationGrade(m.pearsonCorrelation));
    }

    getGradeIcon(grade: Grade): string {
        switch (grade) {
            case 'excellent': return 'verified';
            case 'good': return 'check_circle';
            case 'fair': return 'warning';
            case 'poor': return 'error';
        }
    }

    getVerdictTitle(): string {
        switch (this.getOverallGrade()) {
            case 'excellent': return 'Excellent Agreement';
            case 'good': return 'Good Agreement';
            case 'fair': return 'Fair Agreement';
            case 'poor': return 'Poor Agreement';
        }
    }

    getInsights(): { text: string; grade: Grade }[] {
        if (!this.result) return [];

        const insights: { text: string; grade: Grade }[] = [];
        const gnssGrade = this.getGnssGrade();
        const cep50 = this.result.metrics.gnss.cep50;

        // GNSS insights
        if (gnssGrade === 'excellent') {
            insights.push({ text: `GNSS accuracy is excellent (${cep50.toFixed(1)}m CEP50)`, grade: 'excellent' });
        } else if (gnssGrade === 'good') {
            insights.push({ text: `GNSS accuracy is good (${cep50.toFixed(1)}m CEP50)`, grade: 'good' });
        } else if (gnssGrade === 'fair') {
            insights.push({ text: `GNSS shows moderate deviation (${cep50.toFixed(1)}m CEP50)`, grade: 'fair' });
        } else {
            insights.push({ text: `GNSS has significant deviation (${cep50.toFixed(1)}m CEP50)`, grade: 'poor' });
        }

        // Stream insights
        for (const [name, metrics] of Object.entries(this.result.metrics.streamMetrics)) {
            const correlation = metrics.pearsonCorrelation;
            const streamGrade = this.getCorrelationGrade(correlation);

            if (streamGrade === 'excellent') {
                insights.push({ text: `${name} correlation is excellent (${(correlation * 100).toFixed(1)}%)`, grade: 'excellent' });
            } else if (streamGrade === 'good') {
                insights.push({ text: `${name} correlation is good (${(correlation * 100).toFixed(1)}%)`, grade: 'good' });
            } else if (streamGrade === 'fair') {
                insights.push({ text: `${name} shows moderate correlation (${(correlation * 100).toFixed(1)}%)`, grade: 'fair' });
            } else {
                insights.push({ text: `${name} has weak correlation (${(correlation * 100).toFixed(1)}%)`, grade: 'poor' });
            }
        }

        return insights;
    }

    getIssueIcon(type: string): string {
        switch (type) {
            case 'dropout': return 'signal_disconnected';
            case 'stuck': return 'horizontal_rule';
            case 'cadence_lock': return 'lock';
            default: return 'warning';
        }
    }

    /** Safely convert Firestore Timestamp or any date-like value to Date */
    toSafeDate(val: any): Date | null {
        if (!val) return null;
        if (val instanceof Date) return val;
        if (typeof val.toDate === 'function') return val.toDate();
        if (val.seconds !== undefined) return new Date(val.seconds * 1000);
        return new Date(val);
    }

    getCorrelationLabel(score: number): string {
        const absScore = Math.abs(score);
        if (absScore >= CORRELATION_THRESHOLDS.excellent) return 'Excellent Match';
        if (absScore >= CORRELATION_THRESHOLDS.good) return 'Strong Correlation';
        if (absScore >= CORRELATION_THRESHOLDS.fair) return 'Moderate Correlation';
        return 'Weak Correlation';
    }
}
