import { Component } from '@angular/core';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';


@Component({
  selector: 'app-services-coros',
  templateUrl: './services.coros.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.coros.component.css'],
  standalone: false
})
export class ServicesCorosComponent extends ServicesAbstractComponentDirective {

  public serviceName = ServiceNames.COROSAPI;

  async requestAndSetToken() {
    const state = this.route.snapshot.queryParamMap.get('state');
    const code = this.route.snapshot.queryParamMap.get('code');
    if (state && code) {
      await this.userService.requestAndSetCurrentUserCOROSAPIAccessToken(state, code);
    }
  }

  isConnectedToService(): boolean {
    return !!this.serviceTokens && !!this.serviceTokens.length
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri
  }
}
