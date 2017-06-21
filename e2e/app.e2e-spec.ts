import { TrackToolsPage } from './app.po';

describe('track-tools App', () => {
  let page: TrackToolsPage;

  beforeEach(() => {
    page = new TrackToolsPage();
  });

  it('should display message saying app works', () => {
    page.navigateTo();
    expect(page.getParagraphText()).toEqual('app works!');
  });
});
