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
    styles: [`
    .benchmark-container {
        padding: 1.5rem;
        background: var(--mat-sys-surface-container);
        color: var(--mat-sys-on-surface);
        border-radius: 12px;
    }

    /* Verdict Card */
    .verdict-card {
        margin-bottom: 1.5rem;
        border-radius: 12px;
        border: 2px solid transparent; /* Border will represent status */
        
        /* Card BORDERS only */
        &.excellent { border-color: #11DD55; }
        &.good { border-color: #4CAF50; }
        &.fair { border-color: #FFAA00; }
        &.poor { border-color: #FF3333; }

        /* Custom Avatar styles - Replaces mat-card-avatar to avoid cropping */
        .grade-avatar { 
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            flex-shrink: 0;
            margin-right: 16px; /* Mimic mat-card-avatar spacing */
            
            &.excellent { background: #11DD55; color: white; }
            &.good { background: #4CAF50; color: white; }
            &.fair { background: #FFAA00; color: white; }
            &.poor { background: #FF3333; color: white; }
            
            mat-icon {
                font-size: 24px;
                width: 24px;
                height: 24px;
            }
        }
    }

    .verdict-list {
        list-style: none;
        padding: 0;
        margin: 0.5rem 0 0 0;
        
        li {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.25rem 0;
            font-size: 0.875rem;
            
            mat-icon {
                font-size: 18px;
                width: 18px;
                height: 18px;
                flex-shrink: 0;
            }
        }
    }

    /* Standalone Icons (Verdict List etc) - Color ONLY */
    mat-icon.excellent { color: #11DD55; }
    mat-icon.good { color: #4CAF50; }
    mat-icon.fair { color: #FFAA00; }
    mat-icon.poor { color: #FF3333; }

    /* Bar fills */
    .bar-fill.excellent { background: #11DD55; }
    .bar-fill.good { background: #4CAF50; }
    .bar-fill.fair { background: #FFAA00; }
    .bar-fill.poor { background: #FF3333; }
    
    /* Ensure text remains standard */
    span, li { color: var(--mat-sys-on-surface); }

    .report-header {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }

    .device-pill {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-weight: 500;
        font-size: 0.875rem;
        
        background: var(--pill-color);
        border: 2px solid var(--pill-color);
        color: #ffffff;
        
        mat-icon { 
            color: #ffffff;
            font-size: 18px; 
            width: 18px; 
            height: 18px; 
        }
    }

    .align-chip {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-weight: 500;
        font-size: 0.875rem;
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
        
        mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .vs-badge {
        font-weight: 700;
        opacity: 0.5;
    }

    .metric-card {
        background: var(--mat-app-surface-container-high);
        margin-bottom: 1rem;
        box-shadow: none;
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 12px;
        
        /* Consistent avatar style for sub-cards */
        .grade-avatar {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            flex-shrink: 0;
            background: var(--mat-sys-secondary-container);
            color: var(--mat-sys-on-secondary-container);
            margin-right: 16px;
            
            &.excellent { background: #11DD55; color: white; }
            &.good { background: #4CAF50; color: white; }
            &.fair { background: #FFAA00; color: white; }
            &.poor { background: #FF3333; color: white; }
            
             mat-icon {
                font-size: 24px;
                width: 24px;
                height: 24px;
            }
        }
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
        padding-top: 1rem;
        text-align: center;
    }

    .stat-item {
        display: flex;
        flex-direction: column;
        
        .label { font-size: 0.75rem; opacity: 0.7; }
        .value { 
            font-size: 1.25rem; 
            font-weight: 700;
            font-family: 'Barlow Condensed', sans-serif;
        }
        .value.highlight { color: var(--mat-sys-error); }
    }

    .streams-container {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1rem;
    }

    .correlation-meter {
        margin-top: 1rem;
        margin-bottom: 0.5rem;
        
        .bar-bg {
            height: 8px;
            background: var(--mat-sys-surface-variant);
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 0.5rem;
        }
        
        .bar-fill {
            height: 100%;
            transition: width 0.8s ease-out;
            border-radius: 4px;
            

        }

        .corr-value {
            font-size: 0.875rem;
            font-weight: 600;
            font-family: 'Barlow Condensed', sans-serif;
        }
    }
    
    .mini-stats {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        opacity: 0.7;
        
        .stat-val {
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 1.1em;
            font-weight: 600;
        }
    }
    
    @media (max-width: 599px) {
        .benchmark-container {
            padding: 1rem;
        }
        .stats-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 0.75rem;
        }
        .report-header {
            flex-direction: column;
            gap: 0.5rem;
        }
        .stat-item .value {
            font-size: 1.1rem;
        }
    }

    .quality-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
        border-radius: 8px;
        margin-bottom: 1rem;
    }
    .info-icon { font-size: 20px; width: 20px; height: 20px; }
    
    .issues-title {
        font-weight: 500;
        margin-bottom: 0.5rem;
        font-size: 0.9rem;
    }
    .quality-issues-list {
        margin-top: 1rem;
        max-height: 250px;
        overflow-y: auto;
        /* Using standard scrollbar styling via global css or just native for now */
    }

    .quality-issue {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.75rem;
        border-radius: 8px;
        background: var(--mat-sys-surface-variant);
        margin-bottom: 0.5rem;
        margin-right: 4px; /* Space for scrollbar */
        
        &.high { border-left: 4px solid var(--mat-sys-error); }
        &.medium { border-left: 4px solid var(--mat-sys-tertiary); }
        &.low { border-left: 4px solid var(--mat-sys-outline); }
    }
    .issue-details {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
    }
    .issue-desc { font-size: 0.875rem; font-weight: 500; }
    .issue-meta { font-size: 0.75rem; opacity: 0.7; }
  `],
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
