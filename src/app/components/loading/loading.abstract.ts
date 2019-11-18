import {ChangeDetectorRef} from '@angular/core';

/**
 * Class for handling loading with no change detection
 */
export abstract class LoadingAbstract {

  public isLoading: boolean;

  constructor(private  changeDetector: ChangeDetectorRef) {
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
