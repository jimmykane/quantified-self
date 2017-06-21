import {EventExporterInterface} from './exporter.interface';
import {EventInterface} from '../../event.interface';

export class EventExporterGPX implements EventExporterInterface {

  fileType = 'application/gpx';
  fileExtension = 'gpx';

  getAsString(event: EventInterface): string {
    return undefined;
  }

  getfileExtension(): string {
    return this.fileExtension;
  }

  getFileType(): string {
    return this.fileType;
  }

}
