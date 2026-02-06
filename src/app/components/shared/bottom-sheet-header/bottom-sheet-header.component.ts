import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-bottom-sheet-header',
  templateUrl: './bottom-sheet-header.component.html',
  styleUrls: ['./bottom-sheet-header.component.css'],
  standalone: false
})
export class BottomSheetHeaderComponent {
  @Input() title = '';
  @Input() icon?: string;
  @Input() iconColor: 'primary' | 'accent' | 'warn' | undefined = 'primary';
}
