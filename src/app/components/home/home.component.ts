import { Component, HostListener } from '@angular/core';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { ServiceNames } from '@sports-alliance/sports-lib';


@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: false
})
export class HomeComponent {

  public serviceNames = ServiceNames;
  public currentYear = new Date().getFullYear();

  constructor(public authService: AppAuthService, public router: Router) {

  }

  @HostListener('window:resize', ['$event'])
  getColumnsToDisplayDependingOnScreenSize(event?: any) {
    return window.innerWidth < 600 ? 1 : 2;
  }

  async navigateToDashboardOrLogin() {
    const user = await this.authService.getUser();
    if (user) {
      await this.router.navigate(['/dashboard']);
    } else {
      await this.router.navigate(['/login']);
    }
  }
}
