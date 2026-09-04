import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgStyle } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivityInterface, ActivityTypes, ActivityTypesHelper, EventInterface } from '@sports-alliance/sports-lib';
import {
    resolveActivityTypeMaterialIcon,
    resolvePrimaryActivityType,
} from '../../helpers/activity-type-presentation.helper';
import { AppEventColorService } from '../../services/color/app.event.color.service';

@Component({
    selector: 'app-activity-type-icon',
    templateUrl: './activity-type-icon.component.html',
    styleUrls: ['./activity-type-icon.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [NgStyle, MatIconModule, MatTooltipModule],
})
export class ActivityTypeIconComponent {
    constructor(private eventColorService?: AppEventColorService) {}

    @Input() activityType!: unknown;
    @Input() event: EventInterface | null = null;
    @Input() activity: ActivityInterface | null = null;
    @Input() activities: ActivityInterface[] | null = null;
    @Input() size?: string;
    @Input() vAlign?: string;

    get activityTooltip(): string {
        const value = this.activityType;
        if (value === null || value === undefined) {
            return '';
        }

        if (Array.isArray(value)) {
            return value.map((entry) => String(entry ?? '')).filter(Boolean).join(', ');
        }

        if (typeof value === 'object') {
            const withType = value as { type?: unknown };
            if (withType.type !== undefined && withType.type !== null) {
                return String(withType.type).trim();
            }
        }

        return String(value).trim();
    }

    private resolveColorActivityContext(): { activity: ActivityInterface; activities: ActivityInterface[] } | null {
        const resolvedActivities = this.activities ?? this.event?.getActivities?.() ?? [];
        const resolvedActivity = this.activity ?? resolvedActivities[0] ?? null;
        if (!resolvedActivity || !resolvedActivities.length) {
            return null;
        }

        return {
            activity: resolvedActivity,
            activities: resolvedActivities,
        };
    }

    public get resolvedIconColor(): string {
        const activityContext = this.resolveColorActivityContext();
        if (this.eventColorService && activityContext) {
            const activityColor = this.eventColorService.getActivityColor(activityContext.activities, activityContext.activity);
            if (activityColor) {
                return activityColor;
            }
        }

        const activity = resolvePrimaryActivityType(this.activityType);
        if (!activity || !this.eventColorService) {
            return '';
        }

        const activityTypeEnum = ActivityTypesHelper.resolveActivityType(activity) || ActivityTypes.Other;
        return this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityTypeEnum) || '';
    }

    getIcon(): string {
        return resolveActivityTypeMaterialIcon(this.activityType);
    }
}
