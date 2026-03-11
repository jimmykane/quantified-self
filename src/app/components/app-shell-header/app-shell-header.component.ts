import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-shell-header',
  templateUrl: './app-shell-header.component.html',
  styleUrls: ['./app-shell-header.component.scss'],
  standalone: false
})
export class AppShellHeaderComponent {
  @Input() bannerHeight = 0;
  @Input() headerHidden = false;
  @Input() authState: boolean | null = null;
  @Input() isDashboardRoute = false;
  @Input() isLoginRoute = false;
  @Input() isAdminRoute = false;
  @Input() isHandset = false;
  @Input() showUploadActivities = false;
  @Input() isAdminUser = false;
  @Input() unreadWhatsNewCount = 0;

  @Output() toggleSidenav = new EventEmitter<void>();
  @Output() logoClick = new EventEmitter<void>();
  @Output() whatsNewClick = new EventEmitter<void>();
  @Output() dashboardClick = new EventEmitter<void>();
  @Output() adminClick = new EventEmitter<void>();
  @Output() loginClick = new EventEmitter<void>();
}
