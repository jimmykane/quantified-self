import {FormGroup, ValidationErrors, ValidatorFn} from '@angular/forms';

export const activityDistanceValidator: ValidatorFn = (control: FormGroup): ValidationErrors | null => {
  const startDistance = control.get('startDistance');
  const endDistance = control.get('endDistance');

  if (endDistance.value <= startDistance.value){
    return { 'endDistanceSmallerThanStartDistance': true };
  }
  return null;
};
