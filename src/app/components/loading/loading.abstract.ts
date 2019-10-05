import {UnitBasedAbstract} from '../unit-based/unit-based.abstract';
import {ChangeDetectorRef} from '@angular/core';

/**
 * Class for handling loading with no change detection
 */
export abstract class LoadingAbstract extends UnitBasedAbstract {

  public isLoading: boolean;

  constructor(private  changeDetector: ChangeDetectorRef) {
    super();
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
