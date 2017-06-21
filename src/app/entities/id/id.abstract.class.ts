import {IDClassInterface} from './id.class.interface';
import * as UUID from 'uuid/v4.js';

export abstract class IDClass implements IDClassInterface {

  private id = UUID();

  getID(): string {
    return this.id;
  }
  setID(id: string) {
    this.id = id;
  }
}
