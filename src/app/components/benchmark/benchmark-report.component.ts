import { Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import {
    ActivityInterface,
    ActivityUtilities,
    DataAltitudeMax,
    DataCadenceMax,
    DataHeartRateMax,
    DataPowerMax,
    EventInterface,
    UserSummariesSettingsInterface,
    UserUnitSettingsInterface
} from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { buildDiffMapForStats, buildStatDisplayList } from '../../helpers/stats-diff.helper';
import { BenchmarkQualityIssue, BenchmarkResult } from '../../../../functions/src/shared/app-event.interface';

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

interface BenchmarkDiffChip {
    label: string;
    hasDiff: boolean;
    display?: string;
    percent?: number;
    color?: string;
    absPercent?: number;
}

interface BenchmarkIssueGroup {
    key: string;
    title: string;
    icon: string;
    deviceLabel: string | null;
    deviceColor: string;
    issues: BenchmarkQualityIssue[];
    count: number;
    firstTimestamp: Date | null;
    lastTimestamp: Date | null;
    hasRange: boolean;
}

interface InsightItem {
    label: string;
    value?: string;
    grade: Grade;
}

@Component({
    selector: 'app-benchmark-report',
    template: `
    <div class="benchmark-container qs-overlay-content-root" *ngIf="result">

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

      <!-- Verdict Summary -->
      <div class="verdict-card metric-card qs-overlay-section qs-overlay-section--flat" [ngClass]="getOverallGrade()">
        <div class="metric-card-header">
          <div class="grade-avatar" [ngClass]="getOverallGrade()">
            <mat-icon>{{ getGradeIcon(getOverallGrade()) }}</mat-icon>
          </div>
          <div class="metric-card-heading">
            <div class="metric-card-title">{{ getVerdictTitle() }}</div>
            <div class="metric-card-subtitle">Hardware Benchmark Analysis</div>
          </div>
        </div>
        <div class="metric-card-content">
          <ul class="verdict-list">
            <li *ngFor="let insight of getInsights()">
              <mat-icon [ngClass]="insight.grade">{{ getGradeIcon(insight.grade) }}</mat-icon>
              <span class="insight-label">{{ insight.label }}</span>
              <span *ngIf="insight.value" class="insight-value">{{ insight.value }}</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Diff Chips -->
      <div class="diff-chips-section" *ngIf="diffChips.length > 0">
        <div class="diff-chips-title">Stat Differences</div>
        <div class="diff-chips">
          <div class="diff-chip qs-overlay-section qs-overlay-section--flat" *ngFor="let chip of diffChips" [class.no-diff]="!chip.hasDiff">
            <span class="chip-label">{{ chip.label }}</span>
            <ng-container *ngIf="chip.hasDiff; else noDiff">
              <span class="chip-value">Δ {{ chip.display }}</span>
              <span class="chip-percent" [style.color]="chip.color">{{ chip.percent | number:'1.1-1' }}%</span>
            </ng-container>
            <ng-template #noDiff>
              <span class="chip-nodiff">No diff</span>
            </ng-template>
          </div>
        </div>
      </div>

      <!-- GNSS Section -->
      <section class="metric-card gnss-card qs-overlay-section qs-overlay-section--flat">
        <div class="metric-card-header">
            <div class="grade-avatar" [ngClass]="getGnssGrade()">
                <mat-icon>{{ getGradeIcon(getGnssGrade()) }}</mat-icon>
            </div>
            <div class="metric-card-heading">
              <div class="metric-card-title">GNSS Accuracy</div>
              <div class="metric-card-subtitle">Positional Deviation</div>
            </div>
        </div>
        <div class="metric-card-content stats-grid">
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
        </div>
      </section>

      <section class="metric-card info-card qs-overlay-section qs-overlay-section--flat" *ngIf="result && (result.alignmentApplied || (result.qualityIssues && result.qualityIssues.length > 0))">
        <div class="metric-card-header">
            <div class="grade-avatar">
                <mat-icon>tune</mat-icon>
            </div>
            <div class="metric-card-heading">
              <div class="metric-card-title">Data Quality</div>
              <div class="metric-card-subtitle">Preprocessing & Artifacts</div>
            </div>
        </div>
        <div class="metric-card-content">
            <div class="quality-item qs-overlay-section qs-overlay-section--flat" *ngIf="result.alignmentApplied">
                <mat-icon class="info-icon">schedule</mat-icon>
                <span>Auto-aligned by <strong>{{ result.timeOffsetSeconds }}s</strong> to maximize correlation.</span>
            </div>
            
            <div class="quality-issues-list" *ngIf="qualityIssueGroups.length > 0">
                <p class="issues-title">Detected Issues:</p>
                <div class="quality-issue-group" *ngFor="let group of qualityIssueGroups">
                    <button class="issue-group-header qs-overlay-section qs-overlay-section--flat" type="button"
                        (click)="toggleIssueGroup(group.key)"
                        [attr.aria-expanded]="isIssueGroupExpanded(group.key)">
                        <span class="issue-group-title">
                          <mat-icon>{{ group.icon }}</mat-icon>
                          <span>{{ group.title }}</span>
                          <span class="issue-device-pill issue-group-device" *ngIf="group.deviceLabel"
                            [style.--pill-color]="group.deviceColor">
                            <mat-icon>watch</mat-icon>
                            {{ group.deviceLabel }}
                          </span>
                        </span>
                        <span class="issue-group-meta">
                          <span class="issue-group-count">{{ group.count }}×</span>
                          <span class="issue-group-time" *ngIf="group.firstTimestamp">
                            {{ group.firstTimestamp | date:'shortTime' }}
                            <ng-container *ngIf="group.hasRange">–{{ group.lastTimestamp | date:'shortTime' }}</ng-container>
                          </span>
                          <mat-icon class="issue-group-chevron">
                            {{ isIssueGroupExpanded(group.key) ? 'expand_less' : 'expand_more' }}
                          </mat-icon>
                        </span>
                    </button>
                    <div class="issue-group-details" *ngIf="isIssueGroupExpanded(group.key)">
                        <div class="quality-issue qs-overlay-section qs-overlay-section--flat" *ngFor="let issue of group.issues" [ngClass]="issue.severity">
                            <mat-icon>{{ getIssueIcon(issue.type) }}</mat-icon>
                            <div class="issue-details">
                                <span class="issue-desc">{{ formatIssueDetail(issue) }}</span>
                                <div class="issue-meta">
                                  <span>{{ toSafeDate(issue.timestamp) | date:'mediumTime' }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      </section>

      <div class="streams-container">
        <section class="metric-card stream-card qs-overlay-section qs-overlay-section--flat" *ngFor="let stream of objectKeys(result.metrics.streamMetrics)">
            <div class="metric-card-header">
                <div class="grade-avatar" [ngClass]="getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)">
                    <mat-icon>{{ getGradeIcon(getCorrelationGrade(result.metrics.streamMetrics[stream].pearsonCorrelation)) }}</mat-icon>
                </div>
                <div class="metric-card-heading">
                  <div class="metric-card-title">{{ stream }}</div>
                  <div class="metric-card-subtitle">{{ getCorrelationLabel(result.metrics.streamMetrics[stream].pearsonCorrelation) }}</div>
                </div>
            </div>
            <div class="metric-card-content">
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
            </div>
        </section>
      </div>

    </div>
  `,
    styleUrls: ['./benchmark-report.component.scss'],
    standalone: false
})
export class BenchmarkReportComponent implements OnChanges {
    @Input() result: BenchmarkResult | null = null;
    @Input() referenceColor: string = '';
    @Input() testColor: string = '';
    @Input() event?: EventInterface;
    @Input() unitSettings?: UserUnitSettingsInterface;
    @Input() summariesSettings?: UserSummariesSettingsInterface;
    objectKeys = Object.keys;
    diffChips: BenchmarkDiffChip[] = [];
    qualityIssueGroups: BenchmarkIssueGroup[] = [];
    expandedIssueGroups = new Set<string>();

    private eventColorService = inject(AppEventColorService);

    ngOnChanges(changes: SimpleChanges) {
        if (changes['result'] || changes['event'] || changes['unitSettings'] || changes['summariesSettings']) {
            this.updateDiffChips();
            this.updateQualityIssueGroups();
        }
    }

    getGnssGrade(): Grade {
        if (!this.result) return 'poor';
        const cep50 = this.result.metrics.gnss.cep50;
        if (cep50 <= GNSS_THRESHOLDS.excellent) return 'excellent';
        if (cep50 <= GNSS_THRESHOLDS.good) return 'good';
        if (cep50 <= GNSS_THRESHOLDS.fair) return 'fair';
        return 'poor';
    }

    getStatGapGrade(): Grade | null {
        if (!this.diffChips.length) return null;
        const maxAbs = Math.max(...this.diffChips.map(c => c.absPercent ?? Math.abs(c.percent ?? 0)));
        if (maxAbs <= 5) return 'excellent';
        if (maxAbs <= 10) return 'good';
        if (maxAbs <= 20) return 'fair';
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
        const statGrade = this.getStatGapGrade();
        const allGrades = statGrade ? [gnssGrade, ...streamGrades, statGrade] : [gnssGrade, ...streamGrades];

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

    getInsights(): InsightItem[] {
        if (!this.result) return [];

        const insights: InsightItem[] = [];
        const gnssGrade = this.getGnssGrade();
        const cep50 = this.result.metrics.gnss.cep50;

        // GNSS insights
        if (gnssGrade === 'excellent') {
            insights.push({ label: 'GNSS accuracy is excellent', value: `${cep50.toFixed(1)}m CEP50`, grade: 'excellent' });
        } else if (gnssGrade === 'good') {
            insights.push({ label: 'GNSS accuracy is good', value: `${cep50.toFixed(1)}m CEP50`, grade: 'good' });
        } else if (gnssGrade === 'fair') {
            insights.push({ label: 'GNSS shows moderate deviation', value: `${cep50.toFixed(1)}m CEP50`, grade: 'fair' });
        } else {
            insights.push({ label: 'GNSS has significant deviation', value: `${cep50.toFixed(1)}m CEP50`, grade: 'poor' });
        }

        // Stream insights
        for (const [name, metrics] of Object.entries(this.result.metrics.streamMetrics)) {
            const correlation = metrics.pearsonCorrelation;
            const streamGrade = this.getCorrelationGrade(correlation);

            if (streamGrade === 'excellent') {
                insights.push({ label: `${name} correlation is excellent`, value: `${(correlation * 100).toFixed(1)}%`, grade: 'excellent' });
            } else if (streamGrade === 'good') {
                insights.push({ label: `${name} correlation is good`, value: `${(correlation * 100).toFixed(1)}%`, grade: 'good' });
            } else if (streamGrade === 'fair') {
                insights.push({ label: `${name} shows moderate correlation`, value: `${(correlation * 100).toFixed(1)}%`, grade: 'fair' });
            } else {
                insights.push({ label: `${name} has weak correlation`, value: `${(correlation * 100).toFixed(1)}%`, grade: 'poor' });
            }
        }

        const statInsight = this.getStatDiffInsight();
        if (statInsight) {
            insights.unshift(statInsight);
        }

        return insights;
    }

    private getStatDiffInsight(): InsightItem | null {
        if (!this.diffChips.length) return null;
        const statGrade = this.getStatGapGrade() || 'poor';
        const sorted = [...this.diffChips].sort((a, b) => (b.absPercent ?? 0) - (a.absPercent ?? 0));
        const top = sorted.slice(0, 2);
        const parts = top.map(c => `${c.label} ${c.display || ''}`.trim());
        const joined = parts.join(' • ');
        let qualifier = '';
        switch (statGrade) {
            case 'excellent': qualifier = 'Stat differences are negligible'; break;
            case 'good': qualifier = 'Stat differences are small'; break;
            case 'fair': qualifier = 'Stat differences are noticeable'; break;
            case 'poor': qualifier = 'Stat differences are large'; break;
        }
        return { label: qualifier, value: joined || undefined, grade: statGrade };
    }

    getIssueIcon(type: string): string {
        switch (type) {
            case 'dropout': return 'signal_disconnected';
            case 'stuck': return 'horizontal_rule';
            case 'cadence_lock': return 'lock';
            default: return 'warning';
        }
    }

    getIssueDeviceLabel(issue: BenchmarkQualityIssue): string | null {
        if (!issue) return null;
        if (issue.deviceName) return issue.deviceName;
        if (issue.source === 'reference') return this.result?.referenceName || null;
        if (issue.source === 'test') return this.result?.testName || null;
        return null;
    }

    getIssueDeviceColor(issue: BenchmarkQualityIssue): string {
        if (issue?.source === 'reference') {
            return this.referenceColor || 'var(--mat-sys-primary)';
        }
        if (issue?.source === 'test') {
            return this.testColor || 'var(--mat-sys-tertiary)';
        }
        if (issue?.deviceName && this.result) {
            if (issue.deviceName === this.result.referenceName) {
                return this.referenceColor || 'var(--mat-sys-primary)';
            }
            if (issue.deviceName === this.result.testName) {
                return this.testColor || 'var(--mat-sys-tertiary)';
            }
        }
        return 'var(--mat-sys-primary)';
    }

    formatIssueDetail(issue: BenchmarkQualityIssue): string {
        if (!issue) return '';
        if (issue.type === 'stuck') {
            const description = issue.description ? issue.description.replace(/^Sensor\s+/i, '') : '';
            const trimmed = description.replace(/^sensor\s+/i, '').trim();
            return trimmed.length > 0 ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}` : '';
        }
        return issue.description || '';
    }

    getIssueGroupTitle(issue: BenchmarkQualityIssue): string {
        if (!issue) return '';
        const streamLabel = issue.streamType ? `${issue.streamType} ` : '';
        let title = '';

        switch (issue.type) {
            case 'stuck':
                title = `${streamLabel}sensor stuck`;
                break;
            case 'dropout':
                title = `${streamLabel}signal dropout`;
                break;
            case 'cadence_lock':
                title = `${streamLabel}cadence lock`;
                break;
            default:
                title = issue.description || issue.type;
                break;
        }

        return title.charAt(0).toUpperCase() + title.slice(1);
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

    toggleIssueGroup(key: string) {
        if (this.expandedIssueGroups.has(key)) {
            this.expandedIssueGroups.delete(key);
        } else {
            this.expandedIssueGroups.add(key);
        }
    }

    isIssueGroupExpanded(key: string): boolean {
        return this.expandedIssueGroups.has(key);
    }

    private updateDiffChips() {
        if (!this.result || !this.event) {
            this.diffChips = [];
            return;
        }
        const unitSettings = this.unitSettings;
        if (!unitSettings) {
            this.diffChips = [];
            return;
        }

        const activities = this.event.getActivities?.() || [];
        const reference = activities.find(activity => activity.getID?.() === this.result?.referenceId);
        const test = activities.find(activity => activity.getID?.() === this.result?.testId);
        if (!reference || !test) {
            this.diffChips = [];
            return;
        }

        const compareActivities: ActivityInterface[] = [reference, test];
        const stats = ActivityUtilities.getSummaryStatsForActivities(compareActivities);
        const statsByType = new Map(stats.map(stat => [stat.getType(), stat]));
        const extraStatTypes = [
            DataAltitudeMax.type,
            DataCadenceMax.type,
            DataHeartRateMax.type,
            DataPowerMax.type,
        ];

        extraStatTypes.forEach((statType) => {
            const statA = reference.getStat(statType as any);
            const statB = test.getStat(statType as any);
            if (statA && statB && !statsByType.has(statType)) {
                statsByType.set(statType, statA);
            }
        });

        const statsList = Array.from(statsByType.values());
        const displayedStatsToShow = statsList.map(stat => stat.getType());
        const displayList = buildStatDisplayList(statsList, displayedStatsToShow, unitSettings);
        const diffMap = buildDiffMapForStats(statsList, displayedStatsToShow, compareActivities, unitSettings);

        this.diffChips = displayList
            .filter(stat => diffMap.has(stat.type))
            .map<BenchmarkDiffChip | null>((stat) => {
                const diff = diffMap.get(stat.type);
                if (!diff) {
                    return null;
                }
                return {
                    label: stat.label,
                    hasDiff: true,
                    display: diff.display,
                    percent: diff.percent,
                    color: this.eventColorService.getDifferenceColor(diff.percent),
                    absPercent: Math.abs(diff.percent ?? 0),
                };
            })
            .filter((chip): chip is BenchmarkDiffChip => chip !== null)
            .sort((left, right) => {
                const leftValue = Number.isFinite(left.percent) ? left.percent : 0;
                const rightValue = Number.isFinite(right.percent) ? right.percent : 0;
                return rightValue - leftValue;
            });
    }

    private updateQualityIssueGroups() {
        const issues = this.result?.qualityIssues ?? [];
        if (!issues.length) {
            this.qualityIssueGroups = [];
            this.expandedIssueGroups.clear();
            return;
        }

        const groups = new Map<string, BenchmarkIssueGroup>();
        for (const issue of issues) {
            const deviceLabel = this.getIssueDeviceLabel(issue);
            const key = [issue.type, issue.streamType || '', deviceLabel || ''].join('|');
            let group = groups.get(key);

            if (!group) {
                group = {
                    key,
                    title: this.getIssueGroupTitle(issue),
                    icon: this.getIssueIcon(issue.type),
                    deviceLabel,
                    deviceColor: this.getIssueDeviceColor(issue),
                    issues: [],
                    count: 0,
                    firstTimestamp: null,
                    lastTimestamp: null,
                    hasRange: false,
                };
                groups.set(key, group);
            }

            group.issues.push(issue);
        }

        const grouped = Array.from(groups.values()).map(group => {
            group.issues.sort((a, b) => this.getIssueTime(a) - this.getIssueTime(b));
            group.count = group.issues.length;
            group.firstTimestamp = this.toSafeDate(group.issues[0]?.timestamp);
            group.lastTimestamp = this.toSafeDate(group.issues[group.issues.length - 1]?.timestamp);
            group.hasRange = group.count > 1 &&
                !!group.firstTimestamp &&
                !!group.lastTimestamp &&
                group.firstTimestamp.getTime() !== group.lastTimestamp.getTime();
            return group;
        });

        grouped.sort((left, right) => {
            if (left.count !== right.count) {
                return right.count - left.count;
            }
            return this.getIssueGroupTime(right) - this.getIssueGroupTime(left);
        });

        this.qualityIssueGroups = grouped;

        const validKeys = new Set(grouped.map(group => group.key));
        for (const key of Array.from(this.expandedIssueGroups)) {
            if (!validKeys.has(key)) {
                this.expandedIssueGroups.delete(key);
            }
        }
    }

    private getIssueTime(issue: BenchmarkQualityIssue): number {
        const date = this.toSafeDate(issue?.timestamp);
        return date ? date.getTime() : 0;
    }

    private getIssueGroupTime(group: BenchmarkIssueGroup): number {
        if (group.lastTimestamp) return group.lastTimestamp.getTime();
        if (group.firstTimestamp) return group.firstTimestamp.getTime();
        return 0;
    }
}
