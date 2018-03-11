import {SerializableClassInterface} from '../../serializable/serializable.class.interface';

export class IBIData implements SerializableClassInterface {

  private ibiData = [];

  constructor(ibiData?: Array<number>) {
    if (ibiData) {
      this.addIBIData(ibiData);
    }
  }

  public addIBIData(ibiData: Array<number>) {
    this.ibiData = [...this.ibiData, ...ibiData];
  }

  public getIBIData(): Array<number> {
    return this.ibiData;
  }

  toJSON(): any {
    return this.getIBIData();
  }
}
