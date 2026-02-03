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
          <mat-icon mat-card-avatar [ngClass]="getOverallGrade()">{{ getGradeIcon(getOverallGrade()) }}</mat-icon>
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
        <div class="device-pill reference">
           <mat-icon>star</mat-icon>
           <span>{{ result.referenceName || 'Device A' }}</span>
        </div>
        <div class="vs-badge">VS</div>
        <div class="device-pill test">
           <mat-icon>watch</mat-icon>
           <span>{{ result.testName || 'Device B' }}</span>
        </div>
      </div>

      <!-- GNSS Section -->
      <mat-card class="metric-card gnss-card">
        <mat-card-header>
            <mat-icon mat-card-avatar [ngClass]="getGnssGrade()">{{ getGradeIcon(getGnssGrade()) }}</mat-icon>
            <mat-card-title>GNSS Accuracy</mat-card-title>
            <mat-card-subtitle>Positional Deviation</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content class="stats-grid">
            <div class="stat-item">
                <span class="label">CEP 50%</span>
                <span class="value" [ngClass]="getGnssGrade()">{{ result.metrics.gnss.cep50 | number:'1.2-2' }}m</span>
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

      <!-- Sensor Streams -->
      <div class="streams-container">
        <mat-card class="metric-card stream-card" *ngFor="let stream of objectKeys(result.metrics.streamMetrics)">
            <mat-card-header>
                <mat-icon mat-card-avatar [ngClass]="getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)">
                    {{ getGradeIcon(getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)) }}
                </mat-icon>
                <mat-card-title>{{ stream }}</mat-card-title>
                <mat-card-subtitle>Sensor Correlation</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <div class="correlation-meter">
                    <div class="bar-bg">
                        <div class="bar-fill" 
                             [style.width.%]="result.metrics.streamMetrics[stream].pearsonCorrelation * 100"
                             [ngClass]="getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)">
                        </div>
                    </div>
                    <span class="corr-value" [ngClass]="getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)">
                        {{ result.metrics.streamMetrics[stream].pearsonCorrelation | number:'1.3-3' }} Correlation
                    </span>
                </div>
                <div class="mini-stats">
                    <span>RMSE: {{ result.metrics.streamMetrics[stream].rootMeanSquareError | number:'1.1-1' }}</span>
                    <span>MAE: {{ result.metrics.streamMetrics[stream].meanAbsoluteError | number:'1.1-1' }}</span>
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
        border: 2px solid transparent;
        
        &.excellent { 
            border-color: #4caf50;
            mat-card-avatar { background: #4caf50; color: white; }
        }
        &.good { 
            border-color: #8bc34a;
            mat-card-avatar { background: #8bc34a; color: white; }
        }
        &.fair { 
            border-color: #ff9800;
            mat-card-avatar { background: #ff9800; color: white; }
        }
        &.poor { 
            border-color: #f44336;
            mat-card-avatar { background: #f44336; color: white; }
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
            }
        }
    }

    /* Grade colors */
    .excellent { color: #4caf50 !important; }
    .good { color: #8bc34a !important; }
    .fair { color: #ff9800 !important; }
    .poor { color: #f44336 !important; }

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
        
        &.reference {
            background: var(--mat-sys-primary);
            color: var(--mat-sys-on-primary);
        }
        &.test {
            background: var(--mat-sys-tertiary);
            color: var(--mat-sys-on-tertiary);
        }
        
        mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .vs-badge {
        font-weight: 700;
        opacity: 0.5;
    }

    .metric-card {
        background: var(--mat-sys-surface);
        margin-bottom: 1rem;
        box-shadow: none;
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 12px;
        
        mat-card-avatar {
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
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
        .value { font-size: 1.25rem; font-weight: 700; }
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
            
            &.excellent { background: #4caf50; }
            &.good { background: #8bc34a; }
            &.fair { background: #ff9800; }
            &.poor { background: #f44336; }
        }

        .corr-value {
            font-size: 0.875rem;
            font-weight: 600;
        }
    }
    
    .mini-stats {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        opacity: 0.7;
    }
    
    @media (max-width: 600px) {
        .stats-grid {
            grid-template-columns: repeat(2, 1fr);
        }
        .report-header {
            flex-direction: column;
            gap: 0.5rem;
        }
    }
  `],
    standalone: false
})
export class BenchmarkReportComponent {
    @Input() result?: BenchmarkResult;
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
        const gnssGrade = this.getGnssGrade();
        const streamGrades = this.getStreamGrades();
        const allGrades = [gnssGrade, ...streamGrades];

        // Overall is the worst individual grade
        if (allGrades.includes('poor')) return 'poor';
        if (allGrades.includes('fair')) return 'fair';
        if (allGrades.includes('good')) return 'good';
        return 'excellent';
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
}
