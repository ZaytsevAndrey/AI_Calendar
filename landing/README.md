# Luefy landing (Next.js)

Public, indexable home page. It replaces the old `/login` screen: visitors read about Luefy and sign in
with Google here. The landing and the React app (`frontend/`) are **separate apps with separate builds**
that are served together on **one domain**.

## One domain, two apps

```
https://<site>/            landing   (signed-in visitors are sent to /calendar before first paint)
https://<site>/uk/         landing   (Ukrainian)
https://<site>/calendar    React app
https://<site>/tasks, …    React app
```

`npm run build:site` builds both and `scripts/assemble-site.mjs` puts them into `site/`:
landing files as they are, the app's `index.html` renamed to `app.html`. The static host then applies
three rules (Render: `render.yaml`; locally: `npm run preview:site`):

1. an existing file is served as is (`/` → landing, `/bundle.js` → app, `/_next/*` → landing);
2. `/uk` → `/uk/`;
3. anything else → `/app.html`, and React Router takes over.

Which app a visitor sees depends on `access_token` in `localStorage`, which both apps can read because
they share an origin:

| Visitor | Opens `/` | Opens `/tasks` |
|---------|-----------|----------------|
| Has a token | inline `<head>` script → `/calendar` | app |
| No token | landing | app → `/login` → `/` (landing) |
| Stale token | → `/calendar` → app fails to refresh → `/login` clears the tokens → landing | same |

Crawlers have no token, so they always get the landing. The app pages are `noindex`.

## Sign-in

The landing offers every provider in `src/lib/auth.ts` that is listed in `NEXT_PUBLIC_AUTH_PROVIDERS`
(today Google and Microsoft). They all work the same way, so the token flow stays in the app:

1. Button → `GET {API}/auth/{provider}` → `{ url }` → the provider's consent page.
2. Provider → API callback → `/auth/{provider}/callback?ticket=…` in the React app (stores the JWT) → `/calendar`.
3. A failed round-trip comes back as `/?signin=failed` and the panel shows a message.

On load the panel calls `GET /auth/providers/status`, which also wakes the free API instance, and hides any
provider the server reports as not configured. A 503 on click hides that provider too.
The header "Sign in" is a link to the panel in the hero, so it works for any number of providers.

**Adding a provider** (API side already returning `{ url }` from `GET /auth/<id>` and redirecting to
`/auth/<id>/callback?ticket=…`): add it to `PROVIDERS` in `src/lib/auth.ts`, add its mark in
`src/components/ProviderMark.tsx`, list it in `NEXT_PUBLIC_AUTH_PROVIDERS`. The hero note and the FAQ answer
("Sign in with Google or Microsoft") are built from that list.
An email/password form would be a different component next to the buttons, posting to the API and storing the
tokens the same way the app's callback pages do.

## SEO

Per-locale `metadata` (title, description, canonical, `hreflang` + `x-default`, Open Graph, Twitter card),
`sitemap.xml` with language alternates, `robots.txt`, JSON-LD (`Organization`, `WebSite`, `WebApplication`,
`FAQPage`), semantic headings, self-hosted font (`next/font`), almost no client JS (only the sign-in button).
The PWA manifest is the app's (`frontend/public/manifest.webmanifest`).

## Run locally

```bash
npm start              # from the repo root: API :3001, app :3000, landing :3002 (separate origins)
npm run build:site     # both apps → site/
npm run preview:site   # site/ on http://localhost:4000 with the production routing rules
```

On `npm start` the app keeps its own sign-in form (`REACT_APP_LANDING_URL` is unset), so day-to-day app work
does not need the landing. Use `build:site` + `preview:site` to check the combined behaviour.

## Environment (landing build)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Canonical origin (sitemap, canonical, OG). Set to the custom domain once you have one. |
| `NEXT_PUBLIC_API_BASE_URL` | NestJS API. |
| `NEXT_PUBLIC_AUTH_PROVIDERS` | Sign-in buttons in order, e.g. `google,microsoft` (default). |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Optional Google Search Console token. |

## Editing copy

All text (both languages, FAQ, the example day in the hero) lives in `src/lib/content.ts`.
FAQ entries feed both the page and the `FAQPage` structured data. OG images are `public/og-en.png` / `og-uk.png`
(1200×630).

## After the first deploy

1. Add the site to Google Search Console and submit `/sitemap.xml`.
2. Check the page with the Rich Results Test and PageSpeed Insights.
3. A custom domain helps more than any tag: `*.onrender.com` subdomains rank poorly. Attach it to the static
   site, then update `NEXT_PUBLIC_SITE_URL`, `FRONTEND_URL` on the API and the Google OAuth origins.
