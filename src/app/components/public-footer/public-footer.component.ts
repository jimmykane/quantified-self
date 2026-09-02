import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '../../../environments/environment';
import { QUANTIFIED_SELF_OPERATOR } from '../../shared/company-contact';
import {
  QUANTIFIED_SELF_LICENSE_ID,
  QUANTIFIED_SELF_LICENSE_URL,
  QUANTIFIED_SELF_SOURCE_URL,
} from '../../shared/open-source-license';

@Component({
  selector: 'app-public-footer',
  templateUrl: './public-footer.component.html',
  styleUrls: ['./public-footer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class PublicFooterComponent {
  public readonly currentYear = new Date().getFullYear();
  public readonly operator = QUANTIFIED_SELF_OPERATOR;
  public readonly supportEmail = environment.supportEmail;
  public readonly supportMailtoHref = `mailto:${this.supportEmail}`;
  public readonly contactEmail = 'contact@quantified-self.io';
  public readonly contactMailtoHref = `mailto:${this.contactEmail}`;
  public readonly openSourceLicense = QUANTIFIED_SELF_LICENSE_ID;
  public readonly sourceCodeUrl = QUANTIFIED_SELF_SOURCE_URL;
  public readonly licenseUrl = QUANTIFIED_SELF_LICENSE_URL;
}
