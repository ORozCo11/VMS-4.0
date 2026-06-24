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
php artisan serve
```

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
