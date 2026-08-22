import { Component, Input } from '@angular/core';

export interface BottomSheetHeaderTitleSegment {
  text: string;
  isNumeric: boolean;
}

@Component({
  selector: 'app-bottom-sheet-header',
  templateUrl: './bottom-sheet-header.component.html',
  styleUrls: ['./bottom-sheet-header.component.scss'],
  standalone: false
})
export class BottomSheetHeaderComponent {
  @Input() title = '';
  @Input() titleSegments: readonly BottomSheetHeaderTitleSegment[] | null = null;
  @Input() icon?: string;
  @Input() iconColor: 'primary' | 'accent' | 'warn' | undefined = 'primary';
}
