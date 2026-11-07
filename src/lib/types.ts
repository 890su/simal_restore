export type Language = 'ru' | 'en' | 'ka';
export type Availability = 'in_stock' | 'on_order' | 'out_of_stock' | 'unknown';
export interface Translation {
  title: string;
  description?: string;
  summary?: string;
  url?: string;
  attributes?: { name: string; value: string }[];
}
export interface Product {
  id: string;
  sku?: string;
  categoryIds: string[];
  translations: Partial<Record<Language, Translation>>;
  legacyUrls: string[];
  price: number | null;
  currency: 'GEL';
  availability: Availability;
  images: { src: string; alt: string; sourceUrl?: string }[];
  variants: { id: string; title: string; price?: number | null }[];
  reviewFlags: string[];
  active: boolean;
}
export interface Category {
  hidden?: boolean;
  reviewFlags?: string[];
  id: string;
  slug: string;
  parentId?: string | null;
  translations: Partial<Record<Language, { title: string; url: string }>>;
  legacyUrls: string[];
}
export interface ContentPage {
  reviewReasons?: string[];
  path: string;
  lang: Language;
  title: string;
  description: string;
  heading: string;
  kind: 'information' | 'promotion' | 'news';
  html: string;
  images: { src: string; alt: string }[];
  needsReview: boolean;
  sourcePath: string;
}
export interface Catalog {
  schemaVersion: number;
  products: Product[];
  categories: Category[];
  generatedAt: string;
}
export type PageKind =
  | 'home'
  | 'catalog'
  | 'category'
  | 'product'
  | 'content'
  | 'favorites'
  | 'cart'
  | 'search'
  | 'promotions'
  | 'news';
export interface Route {
  path: string;
  lang: Language;
  kind: PageKind;
  title: string;
  description: string;
  category?: Category;
  product?: Product;
  content?: ContentPage;
  canonicalPath?: string;
  alternates?: { lang: Language; path: string }[];
  noindex?: boolean;
}
