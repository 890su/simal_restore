// Translate restored paths to the URLs used during the short language migration.
const georgianSections = {
  catalog: 'shop',
  product: 'item',
  kompaniya: 'about',
  kontakty: 'contact',
  'oplata-dostavka': 'delivery',
  sotrudnichestvo: 'partners',
  aktsii: 'offers',
  news: 'updates',
};

/** @param {string} sourcePath @param {'ru' | 'en' | 'ka'} lang */
export function migrationPath(sourcePath, lang) {
  if (lang === 'en') return sourcePath;
  if (lang === 'ru') return '/ru' + sourcePath;
  if (!sourcePath.startsWith('/ge/')) {
    throw new Error(`Expected a Georgian source URL under /ge/: ${sourcePath}`);
  }
  const suffix = sourcePath.slice('/ge/'.length);
  if (suffix === 'kontakty/politika-konfidentsialnosti/') return '/privacy/';
  const [section, ...rest] = suffix.split('/');
  return '/' + [Object.hasOwn(georgianSections, section) ? georgianSections[section] : section, ...rest].join('/');
}
