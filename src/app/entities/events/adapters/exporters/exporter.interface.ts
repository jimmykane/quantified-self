import {EventInterface} from '../../event.interface';
export interface EventExporterInterface  {
  readonly fileType;
  readonly fileExtension: string;

  getfileExtension(): string;

  getFileType(): string;

  getAsString(event: EventInterface): string;

}
