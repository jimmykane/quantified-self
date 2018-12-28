import {Component, Input} from '@angular/core';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import * as Raven from 'raven-js';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';

@Component({
  selector: 'app-privacy-icon',
  templateUrl: './privacy-icon.component.html',
  styleUrls: ['./privacy-icon.component.css'],
})

export class PrivacyIconComponent {
  @Input() privacy: Privacy;

  getPrivacyIcon() {
    let iconName = 'lock';
    if (this.privacy === Privacy.public){
      iconName = 'public'
    }
    return iconName;
  }
}
