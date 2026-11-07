/** Reproducible editorial review proposal. Writes only the explicit EN override file. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(root, 'data/normalized-catalog.json'), 'utf8'));
const terms = {
  'Кровать двухъярусная с диваном': 'Bunk bed with sofa', 'Кровать двухспальная "парящая"': 'Double floating bed',
  'Кровать-трансформер для небольших комнат': 'Space-saving convertible bed', 'Кровать - трансформер настенная': 'Wall bed',
  'Кровать-шкаф': 'Wall bed', 'Кровать с подъемным механизмом': 'Bed with a lift mechanism',
  'Металлическая кровать двухспальная': 'Double metal bed', 'Металлическая кровать': 'Metal bed', 'Кровать из металла': 'Metal bed',
  ' с подъемным механизмом': ' with a lift mechanism', 'Двухъярусная кровать': 'Bunk bed',
  'Диван-кровать угловой': 'Corner sofa bed', 'Диван угловой': 'Corner sofa', 'Угловой диван': 'Corner sofa',
  'Диван кровать': 'Sofa bed', 'Диван-кровать': 'Sofa bed', 'Кресло-кровать': 'Chair bed',
  'Компактный диван': 'Compact sofa', 'Комфортный диван': 'Comfort sofa', 'Двухспальный диван': 'Double sleeper sofa',
  'Тумбочка прикроватная': 'Bedside table', 'Тумба прикроватная': 'Bedside table',
  'Комплект постельных принадлежностей': 'Bedding set', 'Комплект выдвижных ящиков': 'Drawer set',
  'Покрывало стеганое': 'Quilted bedspread', 'Подушка диванная': 'Sofa cushion',
  'Полка для шкафа': 'Wardrobe shelf', 'Полка настенная': 'Wall shelf', 'Ящик выдвижной': 'Drawer',
  'Тумба под телевизор': 'TV stand', 'Тумба для обуви': 'Shoe cabinet',
  'Простынь непромокаемая на резинке': 'Waterproof fitted sheet', 'Простынь на резинке цветная': 'Coloured fitted sheet',
  'Простынь на резинке': 'Fitted sheet', 'Защитный непромакающий наматрасник': 'Waterproof mattress protector',
  'Двуспальный матрас для идеального сна': 'Double mattress', 'Матрас двуспальный беспружинный': 'Double springless mattress',
  'Матрас беспружинный': 'Springless mattress', 'Изготовление матрасов под заказ': 'Custom-made mattresses',
  'Комфортный матрас': 'Comfort mattress', 'Интерьерная картина': 'Interior painting',
  'Картина абстракция для интерьера': 'Abstract interior painting', 'Картина акрилом': 'Acrylic painting',
  'Картина художника': "Artist's painting", 'Картина в интерьер': 'Interior painting',
  'Картина для декора помещения': 'Decorative painting', 'Стеновые панели': 'Wall panels',
  'Декоративные панели': 'Decorative panels', 'Кроватное основание': 'Bed base', 'Парящая кровать': 'Floating bed',
  'Раскладной диван кровать': 'Convertible sofa bed', 'Кровать тахта': 'Daybed',
  'Независимый пружинный блок': 'independent pocket springs', ' с двумя ящиками': ' with two drawers',
  ' с зеркалом': ' with mirror', ' распашные двери': ' with hinged doors',
  ' 3 ящика и 2 дверцы': ' with 3 drawers and 2 doors', ' 2 двери со стеклом': ' with 2 glazed doors',
  ' 2 двери 2 ящика': ' with 2 doors and 2 drawers', ' 2 ящика': ' with 2 drawers',
  ' на ножках': ' on legs', ' с подушкой': ' with cushion', ' большая': ' large',
  'Стол компьютерный': 'Computer desk', 'Стол письменный': 'Desk', 'Обеденный стол': 'Dining table',
  'Столик': 'Side table', 'Кровать': 'Bed', 'Диван': 'Sofa', 'Кресло': 'Armchair',
  'Матрас': 'Mattress', 'Наматрасник': 'Mattress topper', 'Подушка': 'Pillow', 'Стеллаж': 'Shelving unit',
  'Полка': 'Shelf', 'Дверца': 'Door', 'Стол': 'Table', 'Тумба': 'Cabinet', 'Комод': 'Chest of drawers',
  'Шкаф': 'Wardrobe', 'Вешалка': 'Coat rack', 'Зеркало': 'Mirror', 'Стул': 'Chair', 'Банкетка': 'Bench', 'Пуф': 'Ottoman',
  'беленый дуб': 'bleached oak', 'Беленый дуб': 'Bleached oak', 'дуб сонома': 'sonoma oak', 'Дуб Венге': 'Wenge oak',
  'дуб венге': 'wenge oak', 'белая': 'white', 'белый': 'white', 'серый': 'grey', 'серая': 'grey',
  'Сонома': 'Sonoma', 'сонома': 'sonoma', 'Эмаль': 'enamel', 'эмаль': 'enamel', 'Венге': 'Wenge',
  'Корица': 'Cinnamon', 'корица': 'cinnamon',
  'навοлочки': 'pillowcases', 'наволочки': 'pillowcases',
};
const attributeNames = {
  'Вес': 'Weight', 'Высота': 'Height', 'Высота сиденья': 'Seat height', 'Высота спинки': 'Headboard / backrest height',
  'Высота царг': 'Side rail height', 'Гарантия': 'Warranty', 'Глубина': 'Depth', 'Диаметр': 'Diameter',
  'Длина': 'Length', 'Длина спального места': 'Sleeping area length', 'Материал': 'Material', 'Производитель': 'Manufacturer',
  'Размеры': 'Dimensions', 'Спальное место': 'Sleeping area', 'Страна производства': 'Country of origin', 'Цвет': 'Colour',
  'Ширина': 'Width', 'Ширина спального места': 'Sleeping area width',
};
const attributeValues = {
  '100% Хлопок': '100% cotton', '1200 мм в разложенном виде 1600 мм': '1200 mm; 1600 mm when extended',
  '1470 мм в разложенном виде 1915 мм': '1470 mm; 1915 mm when extended', '1900-2000 мм на выбор': '1900–2000 mm, choice of length',
  'Акрил': 'Acrylic', 'Акрил + патина': 'Acrylic + patina', 'Бархат': 'Velvet', 'Бежевый': 'Beige', 'Бежевый, серый': 'Beige, grey',
  'Беларусь': 'Belarus', 'Беленый дуб': 'Bleached oak', 'Беленый дуб / Белый': 'Bleached oak / white', 'Белый': 'White',
  'Белый, серый': 'White, grey', 'Белый, серый, дуб венге': 'White, grey, wenge oak', 'Белый, сонома': 'White, sonoma',
  'Белый, сонома (дуб)': 'White, sonoma oak', 'Белый/дуб беленый': 'White / bleached oak',
  'Белый/дымчатый/серый/дуб сонома': 'White / smoky / grey / sonoma oak',
  'Белый/дымчатый/серый/дуб сонома/коппучино': 'White / smoky / grey / sonoma oak / cappuccino',
  'Венге': 'Wenge', 'Грузия': 'Georgia', 'Грузия/Беларусь': 'Georgia / Belarus', 'ДВП': 'Fibreboard',
  'ДВП/стекло': 'Fibreboard / glass', 'ДСП': 'Chipboard', 'ДСП, Стекло': 'Chipboard, glass', 'Дуб беленый': 'Bleached oak',
  'Дуб венге': 'Wenge oak', 'Дуб сонома': 'Sonoma oak', 'ЛДСП (16 мм)': 'Laminated chipboard (16 mm)', 'Любая': 'Any',
  'МДФ': 'MDF', 'МДФ + ПВХ (15мм)': 'MDF + PVC (15 mm)', 'Металл': 'Metal', 'Ножек 12 см': 'Leg height: 12 cm',
  'Окраска в любой цвет': 'Painted in a colour of your choice', 'Пенополиуретан': 'Polyurethane foam', 'Профильная труба': 'Box-section tube',
  'Различные варианты цветов': 'Various colour options', 'Разный': 'Various', 'Серый': 'Grey', 'Серый, бежевый': 'Grey, beige',
  'Серый, коричневый': 'Grey, brown', 'Серый, морская волна': 'Grey, teal', 'Серый, сонома': 'Grey, sonoma', 'Сонома': 'Sonoma',
  'Сонома (дуб)': 'Sonoma oak', 'Сонома дуб, ясень, серый, темно-берюзовый': 'Sonoma oak, ash, grey, dark turquoise',
  'Ткань': 'Fabric', 'Турция': 'Turkey', 'беленый дуб': 'bleached oak', 'белый': 'white',
  'в разложенном виде 2229 мм': '2229 mm when extended', 'от 700 мм': 'from 700 mm', 'серый': 'grey',
};

const replacements = Object.entries(terms).sort((a, b) => b[0].length - a[0].length);
function units(text) {
  return text.replace(/(?:см|cм|сm)/g, 'cm').replace(/мм/g, 'mm').replace(/кг/g, 'kg')
    .replace(/месяцев/g, 'months').replace(/лет/g, 'years').replace(/(\d)[хx](?=\d)/g, '$1×').replace(/\s*\.$/, '').replace(/\s+/g, ' ').trim();
}
function translateTitle(text) {
  let value = text;
  for (const [source, target] of replacements) value = value.split(source).join(target);
  return units(value);
}
function translateAttributes(items) {
  return items.map(item => ({ name: attributeNames[item.name] || item.name, value: units(attributeValues[item.value] || item.value) }));
}
function unknownCyrillic(text) { return /[А-Яа-яЁё]/.test(text.replace(/Кристофер|Бостон|Феникс|Феерия|Тень женщины|Ночное море|Маска|Лица|Девушка|Лоди|Атина|МДК|МД|Б(?=-)|FОRA|Е(?=100)|INGАR|А(?=$)/g, '')); }

const descriptions = {};
function description(ids, text) { for (const id of ids.split(',')) descriptions[id] = text; }
description('9758,9945', 'ODRI is an upholstered bed with a padded headboard and decorative stitching. Reinforced wooden slats form a ventilated base for the mattress. The tall, slender legs leave space for cleaning underneath.');
description('9759,9942', 'PRIMA is an upholstered bed with a quilted headboard and matching fabric on the side rails. The lift-up mechanism gives access to a spacious bedding compartment beneath the sleeping area.');
description('9771,10861', 'The ELITE mattress topper adds a softer layer above a mattress. Its Wave-contoured surface provides cushioning, while the topper helps protect the mattress from dirt and wear.');
description('9772,9931', 'AKTIV is a double-sided mattress with individually pocketed ANTINOISE springs and polyurethane foam comfort layers. The two sides offer different firmness levels. A removable zipped cover has Winter/Summer fabrics for seasonal use.');
description('9785,9940,10379,10431', 'ROYAL is a double-sided mattress with individually pocketed ANTINOISE springs. Its two sides offer different firmness levels. The removable zipped cover has Winter/Summer fabrics and a 3D AirFlow mesh panel around the perimeter for ventilation.');
description('9786,9818,9819,9937,10430', 'This double-sided mattress combines individually pocketed ANTINOISE springs with polyurethane foam comfort layers. Its two sides offer different firmness levels. The cover is removable and zipped for cleaning.');
description('9789', 'LUX is a soft pillow with a filling described by the manufacturer as “swan down”. The microfibre cover has textured quilting and an anti-pilling finish. See the listed dimensions for this pillow.');
description('9820,9934,9935,9936,10991,11202', 'IMPERIAL is a double-sided mattress with independently pocketed ANTINOISE+ springs. Its Family Zone spring arrangement provides longitudinal and transverse zoning, with reinforced sides using Hard Board technology. The removable Winter/Summer cover supports seasonal use. Check the listed dimensions for the selected size.');
description('9924', 'ST-132 is a compact stand that can also be used as a side table. It has a PVC-coated MDF top and a metal frame. Protective end caps help prevent damage to the floor.');
description('10364', 'SIRIUS 4 is a compact white chest of drawers. Its drawers provide storage without taking up much floor space, and the white finish can be combined with furniture in other colours.');
description('10433', 'SIRIUS 2 is a double-door wardrobe with a drawer. The specified maximum load for the drawer is 8 kg.');
description('10530,10532', 'An upholstered bench provides additional seating in a hallway, bedroom or living room. Use it by the entrance when putting on shoes, or at the foot of a bed. Ask the store about other colour options.');
description('13416', 'This compact upholstered ottoman stands on four legs. It can serve as an extra seat or a footrest, and is easy to move between rooms. The black upholstery and simple shape suit a range of interiors.');
description('13447', 'A large upholstered bench with a soft fabric-covered seat and a sturdy frame. It provides extra seating in a hallway, bedroom, living room or dressing area. Ask the store about delivery and assembly options.');
description('13525', 'HARD is a double-sided mattress with an independent pocket spring unit and polyurethane foam comfort layers. One side is medium and the other medium-firm. The listed size is 180×200 cm, with a height of 22 cm and a maximum load of 180 kg per sleeping position.');
description('13528', 'Custom-made mattresses are available for non-standard beds, children’s furniture and replacement projects. Size, shape, firmness and filling can be specified. Contact the store to confirm dimensions, construction options and production time.');
description('13587', 'The ELITE 120×200 mattress topper has a Wave-contoured surface and a removable cover. Elastic corner straps keep it in place. It adds a softer layer above the mattress and helps protect it from dirt. Confirm the current filling and thickness with the store.');
description('13588', 'The ELITE 140×200 mattress topper has a Wave-contoured surface and a removable cover. Elastic corner straps keep it in place. It adds a softer layer above the mattress and helps protect it from dirt. Confirm the current filling and thickness with the store.');
description('13592', 'This Memory Foam mattress topper measures 140×200 cm and has a 5 cm foam layer. Its removable zipped cover can be cleaned, and elastic corner straps help hold the topper in place.');
description('13594', 'This Memory Foam mattress topper measures 180×200 cm and has a 5 cm foam layer. Its removable zipped cover can be cleaned, and elastic corner straps help hold the topper in place.');
description('13597', 'The LUX 160×200 mattress topper is made with elastic polyurethane foam and has a listed height of 9 cm. Its quilted cover and elastic corner straps provide a soft surface and help hold it in place.');

const englishOnlyTitles = {
  '9924': 'ST-132 side table', '10614': 'Transformer shelving unit', '10615': 'SIRIUS coat rack (white)',
  '10857': 'Corner sofa bed LUIGI', '10868': 'Mattress topper MEMORY FORM 1800',
  '13456': 'Corner sofa bed SERGIO (230 cm)', '13495': 'Chair bed PRIMA (106 cm)',
  '13528': 'Custom-size mattresses',
};

const products = {}, untranslated = [], sourceAligned = [], described = [];
for (const product of catalog.products) {
  const copy = product.translations.en, source = product.translations.ru;
  if (!copy?.title || product.id === '13538') continue;
  const review = { title: source?.title ? translateTitle(source.title) : units(englishOnlyTitles[product.id] || copy.title), reviewedFields: ['title'], reviewNote: source?.title ? 'Title aligned to the Russian source for the same stable ID; original model spelling and numeric suffixes retained.' : 'Existing English title checked for language and units; no cross-ID matching.' };
  if (source?.title) sourceAligned.push(product.id);
  const attrs = translateAttributes(source?.attributes?.length ? source.attributes : copy.attributes || []);
  if (!attrs.some(attribute => unknownCyrillic(attribute.name + ' ' + attribute.value))) {
    review.attributes = attrs; review.reviewedFields.push('attributes');
  } else untranslated.push({ id: product.id, field: 'attributes' });
  if (unknownCyrillic(review.title)) {
    review.reviewedFields = review.reviewedFields.filter(field => field !== 'title');
    untranslated.push({ id: product.id, field: 'title', text: review.title });
  }
  if (descriptions[product.id]) {
    review.description = descriptions[product.id];
    review.summary = descriptions[product.id].match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || descriptions[product.id];
    review.reviewedFields.push('description', 'summary');
    review.reviewNote += ' Description rewritten as a concise source-backed version; no missing long description invented.';
    described.push(product.id);
  }
  // These original EN attributes confuse length (200) with height; the same
  // description explicitly defines the 120/140/160/180 × 200 dimensions.
  const topperWidths = { '13587': '120', '13588': '140', '13592': '140', '13594': '180', '13597': '160' };
  if (topperWidths[product.id]) {
    review.attributes = [{ name: 'Width', value: `${topperWidths[product.id]} cm` }, { name: 'Length', value: '200 cm' }];
    if (['13592', '13594'].includes(product.id)) review.attributes.push({ name: 'Height', value: '5 cm' });
    if (product.id === '13597') review.attributes.push({ name: 'Height', value: '9 cm' });
  }
  products[product.id] = review;
}
const categoryTitles = {
  'banketki-i-pufy': 'Benches and ottomans', 'dekorativnye-paneli-mdf': 'Decorative MDF panels', 'kartiny': 'Paintings', 'komody': 'Chests of drawers',
  'kresla-i-kresla-krovati': 'Armchairs and chair beds', 'kresla-test': 'Armchairs', 'krovati': 'Beds',
  'krovati-dvukhyarusnye-krovati': 'Bunk beds', 'krovati-dvuspalnye-krovati': 'Double beds',
  'krovati-krovat-transformer-krovat-shkaf': 'Wall beds and folding beds', 'krovati-odnospalnye-krovati': 'Single beds',
  'krovatnoe-osnovanie-osnovanie-pod-matras': 'Bed bases', 'matrasy': 'Mattresses', 'matrasy-bespruzhinnye-matrasy': 'Springless mattresses',
  'matrasy-detskie-matrasy': 'Children’s mattresses', 'matrasy-dlya-gostinits-i-oteley': 'Hotel mattresses',
  'matrasy-dvuspalnye-matrasy': 'Double mattresses', 'matrasy-matrasy-na-zakaz': 'Custom-made mattresses',
  'matrasy-namatrasniki-i-toppery': 'Mattress toppers and protectors', 'matrasy-odnospalnye-matrasy': 'Single mattresses',
  'matrasy-ortopedicheskie': 'Orthopaedic mattresses', 'matrasy-pruzhinnye-matrasy': 'Spring mattresses',
  'myagkaya-mebel': 'Sofas', 'myagkaya-mebel-divan-krovati': 'Sofa beds', 'myagkaya-mebel-uglovye-divany': 'Corner sofas',
  'postelnoe-belye': 'Bed linen', 'prikrovatnye-tumby': 'Bedside tables', 'shkafy': 'Wardrobes', 'stelazhi': 'Shelving',
  'stoly': 'Tables and desks', 'stulya': 'Chairs', 'tekstil': 'Home textiles', 'toppery-i-namatrasniki': 'Mattress toppers and protectors',
  'tumby': 'Storage cabinets', 'tumby-dlya-obuvi': 'Shoe cabinets', 'tumby-pod-televizor': 'TV stands', 'zerkala': 'Mirrors',
};
const categories = Object.fromEntries(catalog.categories.map(category => {
  if (!categoryTitles[category.id]) throw new Error(`Unreviewed English category ${category.id}`);
  return [category.id, { title: categoryTitles[category.id], reviewedFields: ['title'] }];
}));
const document = {
  schemaVersion: 1, language: 'en', reviewedAt: '2026-11-07', products, categories,
  report: {
    method: 'Editorial review of existing English titles; same-ID Russian source alignment, finite reviewed material/colour/unit vocabulary, and concise replacement of existing English descriptions. Commercial facts were not independently verified.',
    baselineProductCount: catalog.products.length, baselineEnglishTitles: catalog.products.filter(product => product.translations.en.title).length,
    overrideProducts: Object.keys(products).length, sameIdSourceAlignedTitles: sourceAligned.length,
    categoryTitlesReviewed: Object.keys(categories).length,
    existingDescriptionsRewritten: described.length, descriptionIds: described,
    unresolvedLanguageItems: untranslated,
    sourceConflicts: [
      { ids: ['13587', '13588'], issue: 'Original ELITE text specifies 4 cm total height and a 50 mm foam layer. Thickness is not repeated as a confirmed fact; ask supplier to resolve it.' },
      { ids: ['9819'], issue: 'Russian title says HARD 1800, while the source description names EXTRA HARD. Title follows same-ID Russian title; concise description avoids an unsupported model name.' },
      { ids: ['9753', '9818', '10363', '10378', '10840'], issue: 'Archive contains title variants for a stable ID. Review follows the already selected normalized Russian source; source identity conflict remains for owner review.' },
    ],
    excludedInvalidIds: ['13538'],
    limitations: ['Missing English descriptions remain missing.', 'No supplier verification of current specifications, stock, prices or warranties.', 'No English-only ID was merged into a Russian ID.', 'Original vendor model codes and proper model/artwork/finish names such as МДК, МД, Б-, Кристофер, Бостон and Лоди are retained rather than silently renamed.'],
  },
};
await writeFile(path.join(root, 'data/translations-reviewed-en.json'), JSON.stringify(document, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ overrideProducts: document.report.overrideProducts, sameIdSourceAlignedTitles: sourceAligned.length, descriptions: described.length, unresolvedLanguageItems: untranslated }, null, 2));
