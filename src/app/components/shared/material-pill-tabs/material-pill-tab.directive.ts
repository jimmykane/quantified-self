import { Directive, Input, TemplateRef } from '@angular/core';

@Directive({
  selector: 'ng-template[appMaterialPillTab]',
  standalone: false,
})
export class MaterialPillTabDirective {
  @Input('appMaterialPillTab') label = '';
  @Input() tabDisabled = false;

  constructor(public readonly templateRef: TemplateRef<unknown>) {}
}
