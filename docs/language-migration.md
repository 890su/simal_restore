# SIMAL language URL migration

The Georgian homepage moves to `/`, Russian pages move under `/ru/`, and English pages keep their `/en/` URLs. The Google Sheets catalog and archive retain their source URLs. The build maps them to published URLs for HTML, navigation, search, saved items, and new quote notifications.

| Previous URL | After migration |
| --- | --- |
| `/` | Georgian homepage. The Russian homepage is at `/ru/`. |
| `/ge/` | 301 to `/` |
| `/catalog/` | 301 to `/ru/catalog/` |
| `/ge/catalog/` | 301 to `/shop/` |
| `/product/9910/` | 301 to `/ru/product/9910/` |
| `/ge/product/9910/` | 301 to `/item/9910/` |
| `/en/` and English detail URLs | Existing URLs |

Georgian uses `/shop/` and `/item/` so previous Russian catalog and product URLs can still redirect to their Russian equivalents. Moved pages redirect with or without a trailing slash. Previously published archive aliases point directly to the final URL. The old Russian homepage is the only repurposed URL. Language links connect equivalents, each indexable page has its own canonical, and `x-default` points to the Georgian equivalent when available.

Run `npm test`, `npm run check` and `npm run build:verified`. The build writes the full URL mapping to `.work/public-manifest.json` and validates the rendered site. Serve `dist` with `wrangler pages dev dist` to exercise the Pages redirects locally.

Before production, record Search Console clicks, impressions, indexing and crawl errors around the outage. Check a sample of old and new URLs in a Cloudflare preview. Publish the validated build with its redirect file and functions in a single Pages deployment, verify the same sample on `simal.ge`, and submit the updated sitemap. Monitor old and new URLs in Search Console. If a release regression requires rollback, use the previous Pages deployment, which contains the previous canonical URLs and redirect set.
