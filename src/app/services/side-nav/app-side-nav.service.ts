import { Injectable } from '@angular/core';
import { MatSidenav } from '@angular/material/sidenav';

@Injectable({
  providedIn: 'root',
})
export class AppSideNavService {

  private sidenav: MatSidenav;


  public setSidenav(sidenav: MatSidenav) {
    this.sidenav = sidenav;
  }

  public open() {
    return this.sidenav?.open();
  }


  public close() {
    return this.sidenav?.close();
  }

  public toggle(): void {
    this.sidenav?.toggle();
  }
}
