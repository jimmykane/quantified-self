import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppActivityTypeGroupIcons } from '../../services/color/app.activity-type-group.icons';

const ACTIVITY_TYPE_ICON_OVERRIDES: Readonly<Record<string, string>> = {
    virtualcycling: 'computer',
    virtualride: 'computer',
    virtualrunning: 'computer',
    virtualrun: 'computer',
    treadmill: 'sprint',
    indoorrunning: 'sprint',
    ebiking: 'electric_bike',
    ebike: 'electric_bike',
    openwaterswimming: 'waves',
    kayaking: 'kayaking',
    canoeing: 'kayaking',
    paddling: 'kayaking',
    standuppaddling: 'kayaking',
    sup: 'kayaking',
    rowing: 'rowing',
    indoorrowing: 'rowing',
    sailing: 'sailing',
    surfing: 'surfing',
    wakeboarding: 'surfing',
    kitesurfing: 'kitesurfing',
    snowboarding: 'snowboarding',
    iceskating: 'ice_skating',
    snowshoeing: 'snowshoeing',
    walking: 'directions_walk',
    nordicwalking: 'nordic_walking',
    trekking: 'hiking',
    yoga: 'self_improvement',
    pilates: 'self_improvement',
    flexibilitytraining: 'self_improvement',
    weighttraining: 'fitness_center',
    strengthtraining: 'exercise',
    kettlebell: 'weight',
    basketball: 'sports_basketball',
    football: 'sports_soccer',
    americanfootball: 'sports_football',
    rugby: 'sports_rugby',
    tennis: 'sports_tennis',
    golf: 'sports_golf',
    cricket: 'sports_cricket',
    baseball: 'sports_baseball',
    softball: 'sports_baseball',
    handball: 'sports_handball',
    icehockey: 'sports_hockey',
    volleyball: 'sports_volleyball'
};

@Component({
    selector: 'app-activity-type-icon',
    templateUrl: './activity-type-icon.component.html',
    styleUrls: ['./activity-type-icon.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ActivityTypeIconComponent {
    @Input() activityType!: unknown;
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

    private normalizeActivityTypeKey(activity: string): string {
        return activity
            .toLowerCase()
            .replace(/[_-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s/g, '');
    }

    private resolvePrimaryActivityType(): string {
        const value = this.activityType;
        if (value === null || value === undefined) {
            return '';
        }

        if (Array.isArray(value)) {
            return String(value[0] ?? '').trim();
        }

        if (typeof value === 'number') {
            return ActivityTypes[value] || '';
        }

        if (typeof value === 'string') {
            return value.split(',')[0].trim();
        }

        if (typeof value === 'object') {
            const withType = value as { type?: unknown };
            if (withType.type !== undefined && withType.type !== null) {
                return String(withType.type).trim();
            }
        }

        return String(value).trim();
    }

    getIcon(): string {
        const activity = this.resolvePrimaryActivityType();
        if (!activity) {
            return 'category';
        }

        const normalizedActivityType = this.normalizeActivityTypeKey(activity);
        const overrideIcon = ACTIVITY_TYPE_ICON_OVERRIDES[normalizedActivityType];
        if (overrideIcon) {
            return overrideIcon;
        }

        const activityTypeEnum = ActivityTypes[activity as keyof typeof ActivityTypes] || (Object.values(ActivityTypes).includes(activity as ActivityTypes) ? activity as ActivityTypes : ActivityTypes.Other);
        const group = ActivityTypesHelper.getActivityGroupForActivityType(activityTypeEnum);
        return AppActivityTypeGroupIcons[group] || 'category';
    }
}
