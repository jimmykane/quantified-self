import { ChangeDetectorRef, Directive } from '@angular/core';

/**
 * Class for handling loading with no change detection
 */
@Directive()
export abstract class LoadingAbstractDirective {

  public isLoading: boolean;

  constructor(protected changeDetector: ChangeDetectorRef) {
  }

  public loading() {
    this.isLoading = true;
    this.changeDetector.detectChanges();
  }

  public loaded() {
    this.isLoading = false;
    this.changeDetector.detectChanges();
  }
}
