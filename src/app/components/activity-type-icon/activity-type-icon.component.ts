import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { AppActivityTypeGroupIcons } from '../../services/color/app.activity-type-group.icons';

@Component({
    selector: 'app-activity-type-icon',
    templateUrl: './activity-type-icon.component.html',
    styleUrls: ['./activity-type-icon.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ActivityTypeIconComponent {
    @Input() activityType!: string;
    @Input() size?: string;
    @Input() vAlign?: string;

    getIcon(): string {
        if (!this.activityType) {
            return 'sports';
        }
        const activities = this.activityType.split(',').map(a => a.trim());
        const activity = activities[0];

        // Special cases where we want a specific icon regardless of group
        if (activity === 'Virtual Cycling' || activity === 'VirtualRide') {
            return 'computer';
        }
        if (activity === 'Virtual Running' || activity === 'VirtualRun') {
            return 'computer';
        }

        const activityTypeEnum = ActivityTypes[activity as keyof typeof ActivityTypes] || (Object.values(ActivityTypes).includes(activity as ActivityTypes) ? activity as ActivityTypes : ActivityTypes.Other);
        const group = ActivityTypesHelper.getActivityGroupForActivityType(activityTypeEnum);
        return AppActivityTypeGroupIcons[group] || 'sports';
    }
}
