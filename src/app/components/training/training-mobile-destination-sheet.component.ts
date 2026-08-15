import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import type { TrainingDestinationId } from '@shared/training-disciplines';
import { SharedModule } from '../../modules/shared.module';

export interface TrainingMobileDestinationOption {
  id: TrainingDestinationId;
  label: string;
  iconActivityType: string | null;
  materialIcon: string | null;
}

export interface TrainingMobileDestinationSheetData {
  options: readonly TrainingMobileDestinationOption[];
  shortcutIds: readonly TrainingDestinationId[];
  selectedDestination: TrainingDestinationId;
  isAutomatic: boolean;
}

export type TrainingMobileDestinationSheetResult =
  | { kind: 'destination'; destination: TrainingDestinationId }
  | { kind: 'manage_shortcuts' };

interface TrainingMobileDestinationSection {
  id: 'all' | 'shortcuts' | 'more';
  label: string | null;
  options: readonly TrainingMobileDestinationOption[];
}

@Component({
  selector: 'app-training-mobile-destination-sheet',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './training-mobile-destination-sheet.component.html',
  styleUrls: ['./training-mobile-destination-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingMobileDestinationSheetComponent {
  private readonly bottomSheetRef = inject(
    MatBottomSheetRef<
      TrainingMobileDestinationSheetComponent,
      TrainingMobileDestinationSheetResult
    >,
  );
  readonly data = inject<TrainingMobileDestinationSheetData>(MAT_BOTTOM_SHEET_DATA);

  readonly sections: readonly TrainingMobileDestinationSection[] = this.buildSections();

  selectDestination(destination: TrainingDestinationId): void {
    this.bottomSheetRef.dismiss({ kind: 'destination', destination });
  }

  manageShortcuts(): void {
    this.bottomSheetRef.dismiss({ kind: 'manage_shortcuts' });
  }

  close(): void {
    this.bottomSheetRef.dismiss();
  }

  isSelected(option: TrainingMobileDestinationOption): boolean {
    return option.id === this.data.selectedDestination;
  }

  private buildSections(): TrainingMobileDestinationSection[] {
    const optionById = new Map(this.data.options.map(option => [option.id, option]));
    const allTraining = optionById.get('overview');
    const shortcutOptions = this.data.shortcutIds
      .map(id => optionById.get(id))
      .filter((option): option is TrainingMobileDestinationOption => option !== undefined);
    const shortcutIds = new Set(shortcutOptions.map(option => option.id));
    const remainingOptions = this.data.options
      .filter(option => option.id !== 'overview' && !shortcutIds.has(option.id))
      .sort((left, right) => left.label.localeCompare(right.label));

    const sections: TrainingMobileDestinationSection[] = [
      {
        id: 'all',
        label: null,
        options: allTraining ? [allTraining] : [],
      },
      {
        id: 'shortcuts',
        label: this.data.isAutomatic ? 'Automatic shortcuts' : 'Pinned shortcuts',
        options: shortcutOptions,
      },
      {
        id: 'more',
        label: 'More sports',
        options: remainingOptions,
      },
    ];
    return sections.filter(section => section.options.length > 0);
  }
}
