import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {Privacy} from '@sports-alliance/sports-lib';

@Component({
    selector: 'app-privacy-icon',
    templateUrl: './privacy-icon.component.html',
    styleUrls: ['./privacy-icon.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})

export class PrivacyIconComponent {
  @Input() privacy: Privacy;

  getPrivacyIcon() {
    let iconName = 'lock';
    if (this.privacy === Privacy.Public) {
      iconName = 'public'
    }
    return iconName;
  }
}
