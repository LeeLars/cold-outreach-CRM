const IS_GITHUB_PAGES = window.location.hostname === 'leelars.github.io';
const BASE_PATH = IS_GITHUB_PAGES ? '/cold-outreach-CRM/web' : '';

function basePath(path) {
  return BASE_PATH + path;
}
