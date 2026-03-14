# 886 — Gin Rummy

CSC 667 Term Project — Spring 2026

## Team Members

| Name | GitHub | Email |
|------|--------|-------|
| Jacky Yang | Jacky-ChunChi-Yang | cyang16@sfsu.edu |
| Ian Weng | IannnWENG | lweng@sfsu.edu |
| Pei Huan Chang | hobbit200419 | pchang@sfsu.edu |
| Doris Tsai | Shuo-WenTsaiDoris | stsai@sfsu.edu |

## Setup

```bash
npm install
cp .env.example .env
# Make sure the PostgreSQL database in DATABASE_URL already exists
npm run dev
```

## Local Auth Test

1. Start PostgreSQL on your machine.
2. Create the database from `.env`, for example `term_project_dev`.
3. Run `npm run dev`.
4. Open `http://localhost:3000`.
5. Click `Login` or `Register` in the top-right corner of the home page.

The server now auto-runs [schema.sql](/Users/hobbi/Desktop/CSC 667/term-project-chang-tsai-weng-yang/database/schema.sql) on startup, so the `users` table will be created automatically for local testing.

## Scripts

- `npm run dev` — Start development server with hot reload
- `npm run build` — Compile TypeScript
- `npm start` — Run compiled server
- `npm run lint` — Check for lint errors
- `npm run lint:fix` — Auto-fix lint errors
- `npm run format` — Format code with Prettier
