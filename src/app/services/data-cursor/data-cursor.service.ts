import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';

@Injectable()
export class DataCursorService {

  private cursor: BehaviorSubject<{}> = new BehaviorSubject(null);

  constructor() {
  }
}
