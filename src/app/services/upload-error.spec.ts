import {
  isUploadErrorUserActionHandled,
  markUploadErrorUserActionHandled,
} from './upload-error';

describe('upload error helpers', () => {
  it('marks an upload error after an actionable UI has already been shown', () => {
    const original = new Error('Reconnect Wahoo and allow route access before sending routes.');

    const handled = markUploadErrorUserActionHandled(original);

    expect(handled).toBe(original);
    expect(isUploadErrorUserActionHandled(handled)).toBe(true);
  });

  it('preserves the message when a non-Error upload failure is marked', () => {
    const handled = markUploadErrorUserActionHandled({ message: 'Upload rejected' });

    expect(handled.message).toBe('Upload rejected');
    expect(isUploadErrorUserActionHandled(handled)).toBe(true);
  });
});
