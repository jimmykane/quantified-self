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
  template: `
    <section class="assistant-visual-detail">
      <header>
        <span class="visual-icon" aria-hidden="true">
          <mat-icon>{{ data.visual.kind === 'chart' ? 'monitoring' : 'satellite_alt' }}</mat-icon>
        </span>
        <div>
          <h2>{{ data.visual.title }}</h2>
          <p>{{ data.visual.kind === 'chart' ? 'Interactive chart' : 'Satellite map' }}</p>
        </div>
        <button mat-icon-button type="button" aria-label="Close visual" (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <div class="visual-content">
        @if (data.visual.kind === 'chart') {
          <app-assistant-visual-chart [visual]="data.visual" />
        } @else {
          <app-assistant-visual-map [visual]="data.visual" />
        }
      </div>

      @if (data.visual.kind === 'map') {
        <p class="map-disclosure">
          <mat-icon aria-hidden="true">privacy_tip</mat-icon>
          Viewing this map sends the displayed map area to Mapbox for satellite tiles.
        </p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .assistant-visual-detail {
      display: grid;
      gap: 14px;
      width: min(820px, calc(100vw - 48px));
      max-height: min(86vh, 760px);
      padding: 20px;
      overflow: auto;
      box-sizing: border-box;
    }
    header {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
    }
    .visual-icon {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border-radius: 14px;
      color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
    }
    h2, p { margin: 0; }
    h2 { font: var(--mat-sys-title-large); font-weight: 600; }
    header p { color: var(--mat-sys-on-surface-variant); font-size: 0.8rem; }
    .visual-content {
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 16px;
      background: var(--mat-sys-surface-container-lowest);
    }
    .map-disclosure {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.78rem;
      line-height: 1.4;
    }
    .map-disclosure mat-icon { width: 18px; height: 18px; font-size: 18px; }
    @media (max-width: 720px) {
      .assistant-visual-detail {
        width: 100%;
        min-height: min(88dvh, 760px);
        max-height: 88dvh;
        padding: 16px 14px calc(16px + env(safe-area-inset-bottom));
      }
    }
  `],
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
