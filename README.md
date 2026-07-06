<<<<<<< HEAD
<p align="center">
  <img src="frontend-spa/src/assets/vms-logo.png" alt="Barangay VMS Logo" width="160" />
</p>

<h1 align="center">Barangay Vehicle Management System</h1>

<p align="center">
  A full-stack system for managing barangay vehicles, maintenance, issue reports, and fleet activity.
</p>

## Overview

Barangay VMS is composed of two applications:

- **`frontend-spa/`** — React single-page app (Vite) for the workspace dashboard, vehicle records, maintenance, and reporting.
- **`backend-api/`** — Laravel REST API handling authentication, vehicles, maintenance, issue reports, and activity logs.

## Getting Started

### Backend (Laravel)

```bash
cd backend-api
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate --seed
php artisan serve --host=127.0.0.1 --port=8001
```

> **Note:** The SQLite database (`database/database.sqlite`) is intentionally **not** committed to Git. Accounts are recreated on every machine by the seeder — do **not** create users by hand. If you cloned the repo and your logins differ, run `php artisan migrate:fresh --seed` to rebuild the database with the standard accounts.
>
> The frontend expects the API on **port 8001**, so start the backend with `--port=8001` (plain `php artisan serve` defaults to 8000 and the login page will show *"Unable to sign in. Please check your connection."*).

### Seeded login accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@barangay.gov` | `admin123` |
| Custodian | `custodian@barangay.gov` | `custodian123` |
| Maintenance | `maintenance@barangay.gov` | `maintenance123` |

### Frontend (React + Vite)

```bash
cd frontend-spa
npm install
npm run dev
```

## Features

- Role-based workspace (Administrator, Custodian, Maintenance)
- Vehicle records with photos and status tracking
- Maintenance scheduling and expense tracking
- Issue reporting and verification workflow
- Activity logs and dashboard metrics
- Vehicle location density map
=======
# VMS-main
Vehicle Management System Codebase. - Capstone Project.
>>>>>>> 55f0490af969a2651a52a85d0fc39e5fcb8c4385
