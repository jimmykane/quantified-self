import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, PLATFORM_ID, ViewChild, ViewEncapsulation, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { MarketingDocument } from '../../../../../shared/admin-marketing';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { documentFromEditor, safeEditorLink } from './marketing-editor';

@Component({
  selector: 'app-marketing-rich-editor',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  templateUrl: './marketing-rich-editor.component.html',
  styleUrls: ['./marketing-rich-editor.component.scss'],
  // Tiptap creates the ProseMirror child after Angular renders the host.
  encapsulation: ViewEncapsulation.None,
})
export class MarketingRichEditorComponent implements AfterViewInit, OnDestroy {
  private readonly haptics = inject(AppHapticsService);
  private readonly platformId = inject(PLATFORM_ID);
  @ViewChild('editorHost') editorHost?: ElementRef<HTMLElement>;
  @Output() readonly valueChange = new EventEmitter<MarketingDocument>();
  private editor: Editor | null = null;
  private currentValue: MarketingDocument = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
  private lastEmitted: MarketingDocument | null = null;
  private editable = true;
  linkOpen = false;
  linkUrl = '';
  linkError = '';
  active = { bold: false, italic: false, heading: false, bulletList: false, orderedList: false, link: false };

  @Input() set value(value: MarketingDocument) {
    if (!value || value === this.lastEmitted) return;
    this.currentValue = value;
    this.editor?.commands.setContent(value, { emitUpdate: false });
    this.updateActive();
  }
  @Input() set disabled(value: boolean) {
    this.editable = !value;
    this.editor?.setEditable(this.editable);
  }
  get disabled(): boolean { return !this.editable; }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId) || !this.editorHost) return;
    this.editor = new Editor({
      element: this.editorHost.nativeElement,
      content: this.currentValue,
      editable: this.editable,
      extensions: [StarterKit.configure({
        blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false,
        underline: false, heading: { levels: [2] },
        link: { openOnClick: false, autolink: false, defaultProtocol: 'https',
          isAllowedUri: url => !!safeEditorLink(url) },
      })],
      editorProps: {
        attributes: { role: 'textbox', 'aria-label': 'Campaign email body', 'aria-multiline': 'true' },
        handleKeyDown: (_view, event) => this.handleKeydown(event),
      },
      onUpdate: ({ editor }) => {
        this.currentValue = documentFromEditor(editor.view.dom);
        this.lastEmitted = this.currentValue;
        this.valueChange.emit(this.currentValue);
        this.updateActive();
      },
      onSelectionUpdate: () => this.updateActive(),
    });
    this.updateActive();
  }

  ngOnDestroy(): void { this.editor?.destroy(); }

  private updateActive(): void {
    if (!this.editor) return;
    this.active = {
      bold: this.editor.isActive('bold'), italic: this.editor.isActive('italic'),
      heading: this.editor.isActive('heading', { level: 2 }),
      bulletList: this.editor.isActive('bulletList'), orderedList: this.editor.isActive('orderedList'),
      link: this.editor.isActive('link'),
    };
  }
  format(kind: 'bold' | 'italic' | 'heading' | 'bulletList' | 'orderedList'): void {
    if (!this.editor || this.disabled) return;
    const chain = this.editor.chain().focus();
    const applied = kind === 'bold' ? chain.toggleBold().run()
      : kind === 'italic' ? chain.toggleItalic().run()
        : kind === 'heading' ? chain.toggleHeading({ level: 2 }).run()
          : kind === 'bulletList' ? chain.toggleBulletList().run() : chain.toggleOrderedList().run();
    if (applied) this.haptics.selection();
    this.updateActive();
  }
  openLink(): void {
    if (!this.editor || this.disabled) return;
    this.linkOpen = !this.linkOpen;
    this.linkError = '';
    this.linkUrl = this.linkOpen ? this.editor.getAttributes('link')['href'] || '' : '';
    this.haptics.selection();
  }
  applyLink(): void {
    if (!this.editor || this.disabled) return;
    const href = safeEditorLink(this.linkUrl.trim());
    if (!href) { this.linkError = 'Enter an HTTPS or mailto URL.'; this.haptics.error(); return; }
    const selection = this.editor.state.selection;
    const applied = selection.empty && !this.editor.isActive('link')
      ? this.editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
      : this.editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    if (!applied) return;
    this.linkOpen = false;
    this.linkError = '';
    this.haptics.selection();
  }
  removeLink(): void {
    if (!this.editor || this.disabled || !this.editor.isActive('link')) return;
    if (this.editor.chain().focus().extendMarkRange('link').unsetLink().run()) this.haptics.selection();
    this.linkOpen = false;
  }
  handleKeydown(event: KeyboardEvent): boolean {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openLink();
      return true;
    }
    return false;
  }
}
