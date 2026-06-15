import { AfterViewInit, Component, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import {
  CONNECTED_SERVICES_POLICY_SECTION,
  POLICY_CONTENT,
  PolicyItem,
} from '../../shared/policies.content';

@Component({
  selector: 'app-policies',
  templateUrl: './policies.component.html',
  styleUrls: ['./policies.component.scss'],
  standalone: false
})
export class PoliciesComponent implements AfterViewInit, OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly onHashChange = () => this.scrollToCurrentHash();
  private initialScrollTimeoutId: number | null = null;

  policies: PolicyItem[] = POLICY_CONTENT;
  connectedServicesPolicy = CONNECTED_SERVICES_POLICY_SECTION;

  constructor(public authService: AppAuthService, public router: Router) {

  }

  ngAfterViewInit(): void {
    this.document.defaultView?.addEventListener('hashchange', this.onHashChange, { passive: true });
    this.initialScrollTimeoutId = this.document.defaultView?.setTimeout(() => this.scrollToCurrentHash()) ?? null;
  }

  ngOnDestroy(): void {
    if (this.initialScrollTimeoutId !== null) {
      this.document.defaultView?.clearTimeout(this.initialScrollTimeoutId);
      this.initialScrollTimeoutId = null;
    }

    this.document.defaultView?.removeEventListener('hashchange', this.onHashChange);
  }

  private scrollToCurrentHash(): void {
    const fragment = this.document.location.hash.replace('#', '').trim();
    if (!fragment) {
      return;
    }

    const target = this.document.getElementById(fragment);
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }
}
