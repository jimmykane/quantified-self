import { AfterViewInit, Component, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
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
  private readonly route = inject(ActivatedRoute);
  private readonly onHashChange = () => this.scrollToCurrentHash();
  private initialScrollTimeoutId: number | null = null;
  private fragmentSubscription: Subscription | null = null;

  policies: PolicyItem[] = POLICY_CONTENT;
  connectedServicesPolicy = CONNECTED_SERVICES_POLICY_SECTION;

  constructor(public authService: AppAuthService, public router: Router) {

  }

  ngAfterViewInit(): void {
    this.document.defaultView?.addEventListener('hashchange', this.onHashChange, { passive: true });
    this.fragmentSubscription = this.route.fragment.subscribe((fragment) => {
      this.scheduleScrollToFragment(fragment);
    });

    this.scheduleScrollToFragment(
      this.route.snapshot.fragment || this.document.location.hash.replace('#', '').trim(),
    );
  }

  ngOnDestroy(): void {
    this.clearPendingScroll();
    this.fragmentSubscription?.unsubscribe();
    this.fragmentSubscription = null;
    this.document.defaultView?.removeEventListener('hashchange', this.onHashChange);
  }

  private clearPendingScroll(): void {
    if (this.initialScrollTimeoutId !== null) {
      this.document.defaultView?.clearTimeout(this.initialScrollTimeoutId);
      this.initialScrollTimeoutId = null;
    }
  }

  private scheduleScrollToFragment(fragment: string | null | undefined): void {
    this.clearPendingScroll();
    if (!fragment?.trim()) {
      return;
    }

    this.initialScrollTimeoutId = this.document.defaultView?.setTimeout(
      () => this.scrollToFragment(fragment),
    ) ?? null;
  }

  private scrollToCurrentHash(): void {
    const fragment = this.document.location.hash.replace('#', '').trim();
    this.scrollToFragment(fragment);
  }

  private scrollToFragment(fragment: string | null | undefined): void {
    if (!fragment?.trim()) {
      return;
    }

    const target = this.document.getElementById(fragment);
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }
}
