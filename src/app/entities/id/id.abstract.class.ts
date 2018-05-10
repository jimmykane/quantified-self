import {IDClassInterface} from './id.class.interface';
import { v4 as uuid } from 'uuid';

export abstract class IDClass implements IDClassInterface {

  private id = uuid();

  getID(): string {
    return this.id;
  }
  setID(id: string) {
    this.id = id;
  }
}
