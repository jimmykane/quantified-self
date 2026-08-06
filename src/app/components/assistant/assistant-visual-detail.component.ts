import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { AssistantVisual } from '@shared/assistant.types';
import { MaterialModule } from '../../modules/material.module';
import { AssistantVisualChartComponent } from './assistant-visual-chart.component';
import { AssistantVisualMapComponent } from './assistant-visual-map.component';

export interface AssistantVisualDetailData {
  visual: AssistantVisual;
}

@Component({
  selector: 'app-assistant-visual-detail',
  standalone: true,
  imports: [
    MaterialModule,
    AssistantVisualChartComponent,
    AssistantVisualMapComponent,
  ],
  templateUrl: './assistant-visual-detail.component.html',
  styleUrls: ['./assistant-visual-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantVisualDetailComponent {
  private readonly dialogRef = inject(MatDialogRef<AssistantVisualDetailComponent>, {
    optional: true,
  });
  private readonly bottomSheetRef = inject(MatBottomSheetRef<AssistantVisualDetailComponent>, {
    optional: true,
  });
  private readonly dialogData = inject<AssistantVisualDetailData>(MAT_DIALOG_DATA, {
    optional: true,
  });
  private readonly bottomSheetData = inject<AssistantVisualDetailData>(MAT_BOTTOM_SHEET_DATA, {
    optional: true,
  });
  readonly data = this.dialogData ?? this.bottomSheetData!;

  close(): void {
    this.dialogRef?.close();
    this.bottomSheetRef?.dismiss();
  }
}
