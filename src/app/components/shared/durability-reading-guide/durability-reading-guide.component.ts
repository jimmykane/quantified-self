import { ChangeDetectionStrategy, Component, Input, OnDestroy, Optional, Signal, TemplateRef, ViewChild, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { map } from 'rxjs/operators';

export type DurabilityReadingGuideContext = 'event' | 'training';

@Component({
  selector: 'app-durability-reading-guide',
  templateUrl: './durability-reading-guide.component.html',
  styleUrls: ['./durability-reading-guide.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DurabilityReadingGuideComponent implements OnDestroy {
  public readonly useDialog: Signal<boolean>;
  @Input()
  public context: DurabilityReadingGuideContext = 'event';

  private dialogRef: MatDialogRef<unknown> | null = null;

  @ViewChild('durabilityReadingGuideDialogTemplate') private dialogTemplate?: TemplateRef<unknown>;

  constructor(
    private readonly dialog: MatDialog,
    @Optional() breakpointObserver: BreakpointObserver | null = null,
  ) {
    this.useDialog = breakpointObserver
      ? toSignal(breakpointObserver.observe('(max-width: 767px)').pipe(map(state => state.matches)), { initialValue: false })
      : signal(false);
  }

  ngOnDestroy(): void {
    this.dialogRef?.close();
  }

  public get isTrainingContext(): boolean {
    return this.context === 'training';
  }

  public openDialog(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.dialogTemplate || this.dialogRef) {
      return;
    }

    const dialogRef = this.dialog.open(this.dialogTemplate, {
      ariaLabel: 'How to read durability',
      autoFocus: false,
      maxWidth: '360px',
      restoreFocus: true,
      width: 'calc(100vw - 32px)',
    });
    this.dialogRef = dialogRef;
    dialogRef.afterClosed().subscribe(() => {
      if (this.dialogRef === dialogRef) {
        this.dialogRef = null;
      }
    });
  }
}
