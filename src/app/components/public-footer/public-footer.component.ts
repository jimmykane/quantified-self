import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '../../../environments/environment';
import { QUANTIFIED_SELF_OPERATOR } from '../../shared/company-contact';

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
}
