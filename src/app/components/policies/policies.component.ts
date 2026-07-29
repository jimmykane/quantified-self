import { AfterViewInit, Component, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
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
  private readonly pageMode = this.resolvePageMode();
  private readonly onHashChange = () => this.scrollToCurrentHash();
  private initialScrollTimeoutId: number | null = null;
  private fragmentSubscription: Subscription | null = null;

  readonly policies: PolicyItem[] = this.pageMode === 'terms'
    ? POLICY_CONTENT.filter(policy => policy.id === 'tos')
    : this.pageMode === 'privacy'
      ? POLICY_CONTENT.filter(policy => policy.id !== 'tos')
      : POLICY_CONTENT;
  readonly connectedServicesPolicy = CONNECTED_SERVICES_POLICY_SECTION;
  readonly showConnectedServices = this.pageMode !== 'terms';
  readonly pagePath = this.pageMode === 'privacy'
    ? '/privacy'
    : this.pageMode === 'terms'
      ? '/terms'
      : '/policies';
  readonly pageTitle = this.pageMode === 'privacy'
    ? 'Privacy Policy'
    : this.pageMode === 'terms'
      ? 'Terms of Service'
      : 'Legal & Privacy';
  readonly pageSummary = this.pageMode === 'privacy'
    ? 'How Quantified Self handles your data, connected services, processors, security, and privacy rights.'
    : this.pageMode === 'terms'
      ? 'The subscription, renewal, cancellation, refund, pricing, and plan terms for Quantified Self.'
      : 'Transparency about how we handle your data, your rights, and our terms of service.';

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

  private resolvePageMode(): 'all' | 'privacy' | 'terms' {
    const mode = this.route.snapshot.data['policyPage']
      ?? this.route.parent?.snapshot.data['policyPage'];
    return mode === 'privacy' || mode === 'terms' ? mode : 'all';
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
