# Glowbook API

Backend for Glowbook — Express + TypeScript + Prisma + MySQL.

## Quick start

```bash
# 1. Install deps
npm install

# 2. Boot MySQL (Docker)
npm run db:up

# 3. Copy env (defaults match docker-compose)
cp .env.example .env

# 4. Generate Prisma client + run first migration
npm run prisma:generate
npm run prisma:migrate -- --name init

# 5. Seed demo salon (Maison Rosé)
npm run seed

# 6. Start dev server (http://localhost:4000)
npm run dev
```

Demo credentials:

```
Email:    isabella@maisonrose.app
Password: glowbook123
```

## Architecture

- **Express + TypeScript** — modular structure under `src/modules/<domain>`.
- **JWT access tokens** (Bearer header) + **opaque refresh tokens** (HMAC-hashed, stored in MySQL, rotated on use, set as `HttpOnly` cookie on `/api/auth`).
- **Zod** for request validation (`validate(schema, source)`).
- **Prisma** as the ORM with a multi-tenant `Salon` model — every authenticated request resolves `req.salonId` via `requireSalon` middleware.
- **Multer** for receipt uploads (`/uploads/receipts/*`), served statically at `/uploads`.

## Modules

| Path | Purpose |
| --- | --- |
| `auth` | register, login, refresh, logout, me |
| `salon` | tenant profile, business hours, metrics |
| `services` | service catalogue (CRUD) |
| `stylists` | team CRUD + service assignment |
| `clients` | client directory + search |
| `appointments` | bookings, status changes, conflict checks |
| `schedules` | time blocks |
| `payments` | review pending receipts; public upload endpoint |
| `public` | unauthenticated booking flow (`/public/salons/:slug`) |

## Reference

### Auth

```
POST   /api/auth/register       { name, email, password, salonName, salonSlug }
POST   /api/auth/login          { email, password }
POST   /api/auth/refresh        (cookie or { refreshToken })
POST   /api/auth/logout
GET    /api/auth/me             (Bearer)
```

### Public booking

```
GET    /api/public/salons/:slug
GET    /api/public/salons/:slug/availability?from&to&stylistId
POST   /api/public/salons/:slug/bookings
POST   /api/public/payments/:appointmentId/receipt    (multipart: receipt)
```

### Owner area (Bearer required)

```
GET    /api/salon/me                       PATCH /api/salon/me
PUT    /api/salon/me/hours                 GET   /api/salon/me/metrics
GET    /api/services        POST/PATCH/DELETE
GET    /api/stylists        POST/PATCH/DELETE
GET    /api/clients         POST /api/clients          GET /api/clients/:id
GET    /api/appointments    POST              PATCH /api/appointments/:id/status
GET    /api/schedules/blocks   POST          DELETE /api/schedules/blocks/:id
GET    /api/payments
POST   /api/payments/:id/approve   POST /api/payments/:id/reject
```

## Notes

- Stripe is **not** integrated in this sprint — transfer receipts only.
- For production: rotate `JWT_*_SECRET`, set `NODE_ENV=production`, run behind HTTPS so refresh cookies set `Secure`.
