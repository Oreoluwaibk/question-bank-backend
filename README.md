# Question Bank API

API for Question Bank. Learners upload PDF and DOCX study files, get questions, sit a timed attempt, and see analytics. Subscriptions are billed with Paystack. Admins manage users, legal text, deletion requests, and the mobile app version.

The website is [question-website](https://github.com/Oreoluwaibk/question-website). The admin UI is [question-admin-backend](https://github.com/Oreoluwaibk/question-admin-backend).

## Stack

Node.js, Express, and TypeScript. Data is in Supabase. Uploads use Multer. PDF and DOCX text is read with `pdf-parse`, `pdf2json`, `unpdf`, and `mammoth`. Paystack handles subscription webhooks. `render.yaml` and a `Procfile` are set up for Render.

## HTTP surface

Routes are mounted at `/api`. The Paystack webhook is `POST /api/subscription/webhook` and is registered before the JSON parser so the raw body is preserved.

| Prefix | Area |
| --- | --- |
| `/api/auth` | Accounts |
| `/api/upload` | Study-file upload |
| `/api/questions` | Generated questions |
| `/api/attempts` | Tests |
| `/api/analytics` | Scores and history |
| `/api/subscription` | Plans and billing |
| `/api/legal` | Privacy and terms |
| `/api/account-deletion` | Deletion requests |
| `/api/version` | Mobile app version |
| `/api/admin` | Admin operations |

`GET /` is a small health response. The default port is 3000.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Fill in `.env` from `.env.example` (Supabase and Paystack). Do not commit real keys.

`npm run build` compiles TypeScript. `npm start` runs the compiled server (`prestart` builds first).
