import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MarkdownPipe } from '../../helpers/markdown.pipe';
import { searchHelpSections } from '../../helpers/help-search.helper';
import { HELP_ACTIONS, HELP_SECTIONS, HelpAction, HelpSection, HelpSectionId } from '../../shared/help.content';
import { AppHapticsService } from '../../services/app.haptics.service';

interface HelpActionCard extends HelpAction {
  description: string;
}

const HELP_ACTION_DESCRIPTIONS: Record<HelpAction['id'], string> = {
  'email-support': 'Get in touch when you need personal help.',
  'report-bug': 'Share a reproducible problem with the product.',
  'release-notes': 'See recent fixes, improvements, and changes.',
  policies: 'Review data, privacy, and account policies.',
};

const POPULAR_SECTION_IDS: readonly HelpSectionId[] = [
  'activity-calendar',
  'training-analysis',
  'service-connections',
  'uploads-and-imports',
  'ai-insights',
  'troubleshooting',
];

@Component({
  selector: 'app-help-page',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
  ],
  providers: [MarkdownPipe],
  templateUrl: './help-page.component.html',
  styleUrls: ['./help-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpPageComponent implements OnInit, OnDestroy {
  private document = inject(DOCUMENT);
  private breakpointObserver = inject(BreakpointObserver);
  private markdownPipe = inject(MarkdownPipe);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private haptics = inject(AppHapticsService);
  private onHashChange = () => this.selectSectionFromHash();

  readonly sections = computed(() => HELP_SECTIONS);
  readonly actions: readonly HelpActionCard[] = HELP_ACTIONS.map(action => ({
    ...action,
    description: HELP_ACTION_DESCRIPTIONS[action.id],
  }));
  private readonly renderedSections = signal<{
    source: readonly HelpSection[];
    html: Partial<Record<HelpSectionId, SafeHtml>>;
  } | null>(null);
  readonly renderedSectionContent = computed(() => {
    const rendered = this.renderedSections();
    return rendered?.source === this.sections() ? rendered.html : {};
  });
  readonly isHandset = toSignal(
    this.breakpointObserver.observe([Breakpoints.XSmall, Breakpoints.Small]).pipe(map(result => result.matches)),
    { initialValue: false },
  );
  readonly searchQuery = signal('');
  readonly selectedSectionId = signal<HelpSectionId | null>(null);
  readonly hasSearchQuery = computed(() => this.searchQuery().trim().length > 0);
  readonly searchResults = computed(() => searchHelpSections(this.sections(), this.searchQuery()));
  readonly isArticleOpen = computed(() => this.sections().some(section => section.id === this.selectedSectionId()));
  readonly selectedSection = computed<HelpSection>(() => {
    const sectionId = this.selectedSectionId();
    return this.sections().find(section => section.id === sectionId) ?? this.sections()[0];
  });
  readonly popularSections = computed(() =>
    POPULAR_SECTION_IDS
      .map(sectionId => this.sections().find(section => section.id === sectionId))
      .filter((section): section is HelpSection => Boolean(section)),
  );

  ngOnInit(): void {
    this.selectSectionFromFragment(this.route.snapshot.fragment || this.document.location.hash.replace('#', '').trim());
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(event => {
      this.searchQuery.set('');
      this.selectSectionFromFragment(this.router.parseUrl(event.urlAfterRedirects).fragment ?? '');
    });
    this.document.defaultView?.addEventListener('hashchange', this.onHashChange, { passive: true });
  }

  ngOnDestroy() {
    this.document.defaultView?.removeEventListener('hashchange', this.onHashChange);
  }

  openSection(sectionId: HelpSectionId, event?: MouseEvent): void {
    if (event && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    if (!this.isKnownSectionId(sectionId)) return;
    if (this.selectedSectionId() !== sectionId) this.haptics.selection();
    this.searchQuery.set('');
    this.selectSection(sectionId, true);
  }

  returnToHelpCenter(): void {
    this.searchQuery.set('');
    this.selectedSectionId.set(null);
    this.setHistoryFragment(null);
  }

  onSearchQueryChange(query: string): void {
    this.searchQuery.set(query);
    if (query.trim()) {
      this.selectedSectionId.set(null);
      this.setHistoryFragment(null);
    }
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  private selectSectionFromHash(): void {
    const sectionId = this.document.location.hash.replace('#', '').trim();
    this.selectSectionFromFragment(sectionId);
  }

  private selectSectionFromFragment(fragment: string): void {
    // Hosting redirects may forward the original query after the destination fragment.
    const sectionId = fragment.split('?', 1)[0];
    if (!this.isKnownSectionId(sectionId)) {
      this.selectedSectionId.set(null);
      return;
    }

    this.selectSection(sectionId, false);
  }

  private selectSection(sectionId: HelpSectionId, updateHistory: boolean): void {
    if (!this.isKnownSectionId(sectionId)) return;
    this.selectedSectionId.set(sectionId);
    if (updateHistory) {
      this.setHistoryFragment(sectionId);
    }
  }

  private setHistoryFragment(sectionId: HelpSectionId | null): void {
    const currentHash = this.document.location.hash.replace('#', '').trim();
    const nextHash = sectionId ?? '';
    if (currentHash === nextHash) {
      return;
    }

    const pathWithQuery = `${this.document.location.pathname}${this.document.location.search}`;
    const nextUrl = sectionId ? `${pathWithQuery}#${sectionId}` : pathWithQuery;
    this.document.defaultView?.history.replaceState(null, '', nextUrl);
  }

  private isKnownSectionId(sectionId: string): sectionId is HelpSectionId {
    return this.sections().some(section => section.id === sectionId);
  }

  private readonly sectionRendering = effect(onCleanup => {
    const sections = this.sections();
    let current = true;
    onCleanup(() => { current = false; });
    untracked(() => {
      const sectionId = this.selectedSectionId();
      if (sectionId && !this.isKnownSectionId(sectionId)) this.selectedSectionId.set(null);
    });
    void this.preRenderSectionContent(sections).then(html => {
      if (current) this.renderedSections.set({ source: sections, html });
    });
  });

  private async preRenderSectionContent(sections: readonly HelpSection[]): Promise<Partial<Record<HelpSectionId, SafeHtml>>> {
    const renderedSections = await Promise.all(
      sections.map(async section => ({
        id: section.id,
        html: await this.markdownPipe.transform(section.content),
      })),
    );

    return renderedSections.reduce<Partial<Record<HelpSectionId, SafeHtml>>>((content, rendered) => ({
        ...content,
        [rendered.id]: rendered.html,
      }), {});
  }
}
