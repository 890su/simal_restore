# SIMAL storefront

Мебельный каталог SIMAL на Astro + TypeScript. GitHub хранит исходный код; Cloudflare Pages публикует статическую сборку и API заявок. Восстановленный Bitrix остаётся в site/ как архив материалов, но папка публикации теперь dist/.

## Запуск

Нужен Node.js 24 LTS.

~~~sh
npm ci
npm run catalog
npm run content
node scripts/prepare-public.mjs
npm run dev
~~~

Dev-сервер: http://127.0.0.1:4321/. Astro dev обслуживает витрину; серверная заявка проверяется отдельно через Wrangler Pages с локальным D1. Без настроенного API доступна явная кнопка WhatsApp. Открытие сообщения не считается отправкой.

~~~sh
npm test
npm run check
npm run build
npm run preview
~~~

Сборка проверяет готовые HTML, ссылки и ресурсы, canonical, hreflang, sitemap и редиректы. Отчёт: .work/build-audit.json. Общие компоненты: src/components/. Токены и адаптивные стили: src/styles/global.css. Чистая модель корзины: src/lib/selection-state.mjs. Контакты не сохраняются в localStorage.

`npm run build` сначала импортирует текущую таблицу. Если Google временно недоступен, команда останавливается. Для выпуска из уже проверенного снимка Sheets можно явно использовать `npm run build:verified`; он не обновляет каталог и не выдаёт старые данные за новый импорт. Источник и SHA-256 снимка записаны в `data/normalized-catalog.json`.

## Каталог и Google Таблицы

1. Открыть [рабочую Google Таблицу SIMAL](https://docs.google.com/spreadsheets/d/1vLx2KoR4AR3YvzcjLLvd_Q3-5Q8RyMpqnyDAQwV4hVg/edit#gid=391044452), лист Products.
2. Редактировать Products, сохраняя постоянный ID. В таблице только публичные данные ассортимента, без клиентских контактов и секретов. Резервные файлы для импорта: deliverables/simal-catalog.xlsx и data/catalog-template.csv.
3. Публичный источник записан в catalog.config.json: spreadsheetId, gid и CSV URL. Импорт выбирает --source → CATALOG_CSV_URL → включённый config.csvUrl → архив. Для обычной работы после включения config отдельная переменная среды не нужна.
4. Выполнить сборку и публикацию. Правки таблицы появляются после успешной публикации, а не немедленно. Ошибка доступа к выбранному CSV останавливает сборку; подмена таблицы архивом автоматически не выполняется.

~~~sh
node scripts/import-catalog.mjs --source "https://example.org/catalog.csv"
node scripts/import-catalog.mjs --check
node scripts/import-catalog.mjs --archive
node scripts/export-catalog-csv.mjs --output data/catalog-template.csv
~~~

--check проверяет выбранный источник без записи normalized JSON. --archive явно игнорирует env/config для автономного восстановления; после него применяется node scripts/apply-translation-reviews.mjs. Критическая ошибка импорта не перезаписывает рабочий снимок. В catalog.config.json находятся только публичные идентификаторы, без токенов. [Подробности каталога](docs/catalog-data.md). [Фактический статус Google Таблицы](docs/catalog-sheet.json).

Фотографии принимаются из проверенных файлов, сопоставленных с товаром. Пропуски показаны явно. Точные найденные копии привязываются через data/image-recovery.json; похожее фото другого товара не считается оригиналом.

## Заявки

POST /api/quote принимает ID и количества; названия, цены и ссылки проверяет сервер. D1 атомарно сохраняет заявку, позиции и outbox. Повтор неизменённого запроса с тем же UUID возвращает прежний номер. Ошибка Telegram не удаляет заявку.

Обязательны binding QUOTES_DB, migrations/0001_quotes.sql и серверный QUOTE_IP_HASH_SECRET. Для Telegram и закрытых endpoints нужны дополнительные переменные из .dev.vars.example. Секреты не коммитятся. Без D1 и секрета API возвращает 503, интерфейс сохраняет введённое и предлагает WhatsApp.

[Эксплуатация заявок](docs/quote-operations.md). Scheduler подготовлен, по умолчанию выключен. Наличие кода не означает, что внешние сервисы уже настроены.

## Публикация

Папка публикации — dist/. site/ остаётся архивом. Не публиковать .env, .dev.vars, .work или служебные источники.

~~~sh
npx wrangler whoami
npm run build
npx wrangler pages deploy dist --project-name simal --branch preview
~~~

Для неиндексируемого preview задать SITE_NOINDEX=true перед сборкой; production пересобрать без флага. D1 и секреты preview/production разделяются. CI проверяет код; отдельный workflow публикует вручную после настройки секретов. Автоматический выпуск в production не включён.

[Процедура и откат](docs/deployment.md). [План](docs/rebuild-plan.md). [SEO и восстановление контента](docs/seo-migration.md).

Архивные цены, наличие, акции и адреса требуют проверки владельцем. Конфликтующие цены остаются null («Цена по запросу»). Переводы проверяются и исправляются; язык и статус проверки перевода не закрывают страницы от индексации. Архивные акции, служебные страницы и действительно пустые карточки имеют отдельные правила индексации. Сохранённый URL не подтверждает актуальность коммерческих условий.
