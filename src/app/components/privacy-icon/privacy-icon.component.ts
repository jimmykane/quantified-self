import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';

@Component({
  selector: 'app-privacy-icon',
  templateUrl: './privacy-icon.component.html',
  styleUrls: ['./privacy-icon.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class PrivacyIconComponent {
  @Input() privacy: Privacy;

  getPrivacyIcon() {
    let iconName = 'lock';
    if (this.privacy === Privacy.Public){
      iconName = 'public'
    }
    return iconName;
  }
}
