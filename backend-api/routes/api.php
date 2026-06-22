<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\FleetController;
use App\Http\Controllers\TicketController;
use App\Http\Controllers\NotificationController;

/*
|--------------------------------------------------------------------------
| Public Routes (No Bearer Token Required)
|--------------------------------------------------------------------------
*/
Route::post('/login', [AuthController::class, 'login']);

/*
|--------------------------------------------------------------------------
| Protected Routes (Requires a Valid Sanctum Token in Header)
|--------------------------------------------------------------------------
*/
Route::middleware('auth:sanctum')->group(function () {
    
    // Session termination route
    Route::post('/logout', [AuthController::class, 'logout']);

    // Secure user identification endpoint (useful for checking active status on refresh)
    Route::get('/user', function (Request $request) {
        return $request->user();
    });

    Route::get('/greeting', [AuthController::class, 'greeting']);
    Route::put('/profile/password', [AuthController::class, 'updatePassword']);

    Route::get('/lookups', [FleetController::class, 'lookups']);
    Route::get('/dashboard', [FleetController::class, 'dashboard']);

    Route::get('/categories', [FleetController::class, 'categories']);
    Route::post('/categories', [FleetController::class, 'storeCategory']);
    Route::put('/categories/{category}', [FleetController::class, 'updateCategory']);
    Route::delete('/categories/{category}', [FleetController::class, 'deleteCategory']);

    Route::get('/vehicles', [FleetController::class, 'vehicles']);
    Route::post('/vehicles', [FleetController::class, 'storeVehicle']);
    Route::put('/vehicles/{vehicle}', [FleetController::class, 'updateVehicle']);
    Route::delete('/vehicles/{vehicle}', [FleetController::class, 'archiveVehicle']);

    Route::get('/locations', [FleetController::class, 'locations']);
    Route::post('/locations', [FleetController::class, 'storeLocation']);

    Route::get('/conditions', [FleetController::class, 'conditions']);
    Route::post('/conditions', [FleetController::class, 'storeCondition']);
    Route::put('/conditions/{condition}', [FleetController::class, 'updateCondition']);
    Route::delete('/conditions/{condition}', [FleetController::class, 'deleteCondition']);

    Route::get('/issues', [FleetController::class, 'issues']);
    Route::post('/issues', [FleetController::class, 'storeIssue']);
    Route::put('/issues/{issue}', [FleetController::class, 'updateIssue']);

    Route::get('/maintenance-records', [FleetController::class, 'maintenanceRecords']);
    Route::post('/maintenance-records', [FleetController::class, 'storeMaintenanceRecord']);
    Route::put('/maintenance-records/{record}', [FleetController::class, 'updateMaintenanceRecord']);
    Route::put('/maintenance-records/{record}/verify', [FleetController::class, 'verifyMaintenance']);
    Route::put('/maintenance-records/{record}/confirm', [FleetController::class, 'confirmMaintenance']);

    Route::get('/maintenance-schedules', [FleetController::class, 'schedules']);
    Route::post('/maintenance-schedules', [FleetController::class, 'storeSchedule']);
    Route::put('/maintenance-schedules/{schedule}', [FleetController::class, 'updateSchedule']);
    Route::delete('/maintenance-schedules/{schedule}', [FleetController::class, 'deleteSchedule']);

    Route::get('/histories', [FleetController::class, 'histories']);
    Route::get('/reports', [FleetController::class, 'reports']);
    Route::get('/logs', [FleetController::class, 'logs']);

    /*
    |--------------------------------------------------------------------------
    | Maintenance Ticket Workflow Routes (5-Phase DFD)
    |--------------------------------------------------------------------------
    */

    // Lookups & listing
    Route::get('/tickets/lookups', [TicketController::class, 'lookups']);
    Route::get('/tickets', [TicketController::class, 'index']);
    Route::get('/tickets/{ticket}', [TicketController::class, 'show']);

    // Phase 1 — Admin: Create ticket & assign to Custodian
    Route::post('/tickets', [TicketController::class, 'createTicket']);

    // Phase 2 — Custodian: Submit inspection results
    Route::put('/tickets/{ticket}/inspect', [TicketController::class, 'submitInspection']);

    // Phase 3 — Admin: Dispatch work order to mechanic
    Route::put('/tickets/{ticket}/assign-mechanic', [TicketController::class, 'assignMechanic']);

    // Phase 3 — Mechanic: Log physical repairs
    Route::put('/tickets/{ticket}/log-repairs', [TicketController::class, 'logRepairs']);

    // Phase 4 Tier 1 — Custodian: Verify repair integrity
    Route::put('/tickets/{ticket}/verify', [TicketController::class, 'verifyRepair']);

    // Phase 4 Tier 2 — Admin: Confirm or reopen ticket
    Route::put('/tickets/{ticket}/confirm', [TicketController::class, 'confirmTicket']);

    // Admin: Cancel ticket at any stage
    Route::put('/tickets/{ticket}/cancel', [TicketController::class, 'cancelTicket']);
    Route::put('/tickets/{ticket}/uncancel', [TicketController::class, 'uncancelTicket']);

    // Admin: Delete ticket completely (in case of mistakes)
    Route::delete('/tickets/{ticket}', [TicketController::class, 'deleteTicket']);

    // Phase 5 — Admin: Read-only archived ticket audit log
    Route::get('/ticket-archives', [TicketController::class, 'archives']);
    Route::put('/ticket-archives/{archive}/reopen', [TicketController::class, 'reopenArchive']);

    // Notifications API
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::put('/notifications/read-all', [NotificationController::class, 'markAllAsRead']);
    Route::put('/notifications/{notification}/read', [NotificationController::class, 'markAsRead']);
    Route::delete('/notifications/{notification}', [NotificationController::class, 'destroy']);
});
