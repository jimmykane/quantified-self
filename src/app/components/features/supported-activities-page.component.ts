import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  SUPPORTED_ACTIVITIES_ROUTE_DATA,
  SUPPORTED_ACTIVITY_FAMILIES,
  SUPPORTED_ACTIVITY_PRESENTATION_NOTES,
  SUPPORTED_ACTIVITY_SUPPORT_LEVELS,
  SUPPORTED_ACTIVITY_TYPE_COUNT,
  type SupportedActivityFamily,
} from './supported-activities-page.content';

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}

@Component({
  selector: 'app-supported-activities-page',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './supported-activities-page.component.html',
  styleUrls: ['./supported-activities-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportedActivitiesPageComponent {
  readonly routeData = SUPPORTED_ACTIVITIES_ROUTE_DATA;
  readonly totalActivityTypeCount = SUPPORTED_ACTIVITY_TYPE_COUNT;
  readonly supportLevels = SUPPORTED_ACTIVITY_SUPPORT_LEVELS;
  readonly presentationNotes = SUPPORTED_ACTIVITY_PRESENTATION_NOTES;
  readonly searchQuery = signal('');
  readonly filteredFamilies = computed<readonly SupportedActivityFamily[]>(() => {
    const normalizedQuery = normalizeSearchValue(this.searchQuery());
    if (!normalizedQuery) {
      return SUPPORTED_ACTIVITY_FAMILIES;
    }

    return SUPPORTED_ACTIVITY_FAMILIES.reduce<SupportedActivityFamily[]>((families, family) => {
      const familyMatches = normalizeSearchValue(family.label).includes(normalizedQuery);
      const matchingActivityTypes = family.activityTypes.filter(activityType => (
        normalizeSearchValue(activityType).includes(normalizedQuery)
      ));

      if (!familyMatches && matchingActivityTypes.length === 0) {
        return families;
      }

      families.push({
        ...family,
        activityTypes: familyMatches ? family.activityTypes : matchingActivityTypes,
      });
      return families;
    }, []);
  });
  readonly visibleActivityTypeCount = computed(() => this.filteredFamilies()
    .reduce((count, family) => count + family.activityTypes.length, 0));
  readonly searchResultSummary = computed(() => {
    const familyCount = this.filteredFamilies().length;
    const activityTypeCount = this.visibleActivityTypeCount();

    if (!this.searchQuery().trim()) {
      return `${this.totalActivityTypeCount} recognized activity types across ${SUPPORTED_ACTIVITY_FAMILIES.length} families.`;
    }

    return `${activityTypeCount} activity type${activityTypeCount === 1 ? '' : 's'} in ${familyCount} famil${familyCount === 1 ? 'y' : 'ies'} match your search.`;
  });

  onSearchQueryChange(query: string): void {
    this.searchQuery.set(query);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }
}
