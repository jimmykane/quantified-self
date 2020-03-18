import { UPLOAD_STATUS } from './upload-status/upload.status';

export interface FileInterface {
  file: File,
  name: string,
  status: UPLOAD_STATUS,
  extension: string,
  filename: string,
}
