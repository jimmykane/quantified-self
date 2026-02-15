import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-event-section-header',
  templateUrl: './event.section-header.component.html',
  styleUrls: ['./event.section-header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventSectionHeaderComponent {
  @Input() icon = '';
  @Input() title = '';
}
