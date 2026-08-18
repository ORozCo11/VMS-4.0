<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\FleetController;
use App\Http\Controllers\HubController;
use App\Http\Controllers\TicketController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\UserController;
use App\Http\Middleware\EnsureUserIsActive;

/*
|--------------------------------------------------------------------------
| Public Routes (No Bearer Token Required)
|--------------------------------------------------------------------------
*/
// Rate-limited to blunt credential brute-forcing: 10 attempts/min per IP.
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

/*
|--------------------------------------------------------------------------
| Protected Routes (Requires a Valid Sanctum Token in Header)
|--------------------------------------------------------------------------
*/
Route::middleware(['auth:sanctum', EnsureUserIsActive::class])->group(function () {
    
    // Session termination route
    Route::post('/logout', [AuthController::class, 'logout']);

    // Secure user identification endpoint (useful for checking active status on refresh)
    Route::get('/user', function (Request $request) {
        return $request->user();
    });

    // DEV-ONLY impersonation (fast role-switching for testing). These handlers
    // return 404 unless APP_ENV is local/testing, so they don't exist in prod.
    Route::get('/impersonate/candidates', [AuthController::class, 'impersonationCandidates']);
    Route::post('/impersonate/{user}', [AuthController::class, 'impersonate']);

    Route::get('/greeting', [AuthController::class, 'greeting']);
    // Verifies the current password, so rate-limit it against guessing too.
    Route::put('/profile/password', [AuthController::class, 'updatePassword'])->middleware('throttle:10,1');

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
    Route::post('/vehicles/{vehicle}/restore', [FleetController::class, 'restoreVehicle']);
    Route::put('/vehicles/{vehicle}/decommission', [FleetController::class, 'decommissionVehicle']);
    Route::get('/vehicles/{vehicle}/reliability', [FleetController::class, 'vehicleReliability']);
    Route::get('/vehicles/{vehicle}/readiness', [FleetController::class, 'vehicleReadiness']);
    Route::post('/vehicles/{vehicle}/readiness-check', [FleetController::class, 'storeReadinessCheck']);
    Route::put('/vehicles/{vehicle}/mark-available', [FleetController::class, 'markVehicleAvailable']);
    Route::get('/vehicles/{vehicle}/open-tickets', [TicketController::class, 'openTicketsForVehicle']);
    Route::get('/vehicles/{vehicle}/recurrence', [FleetController::class, 'checkVehicleRecurrence']);

    Route::get('/locations', [FleetController::class, 'locations']);
    Route::post('/locations', [FleetController::class, 'storeLocation']);

    Route::get('/users', [UserController::class, 'index']);
    Route::post('/users', [UserController::class, 'store']);
    Route::put('/users/{user}', [UserController::class, 'update']);
    Route::put('/users/{user}/deactivate', [UserController::class, 'deactivate']);
    Route::put('/users/{user}/activate', [UserController::class, 'activate']);

    Route::get('/hubs', [HubController::class, 'index']);
    Route::post('/hubs', [HubController::class, 'store']);
    Route::put('/hubs/{hub}', [HubController::class, 'update']);
    Route::delete('/hubs/{hub}', [HubController::class, 'destroy']);

    Route::get('/conditions', [FleetController::class, 'conditions']);
    Route::post('/conditions', [FleetController::class, 'storeCondition']);
    Route::put('/conditions/{condition}', [FleetController::class, 'updateCondition']);
    Route::delete('/conditions/{condition}', [FleetController::class, 'deleteCondition']);

    Route::get('/issues', [FleetController::class, 'issues']);
    Route::get('/vehicles/{vehicle}/open-issues', [FleetController::class, 'openIssuesForVehicle']);
    Route::get('/issues/{issue}', [FleetController::class, 'showIssue']);
    Route::post('/issues', [FleetController::class, 'storeIssue']);
    Route::put('/issues/{issue}', [FleetController::class, 'updateIssue']);
    Route::delete('/issues/{issue}', [FleetController::class, 'destroyIssue']);

    Route::get('/maintenance-records', [FleetController::class, 'maintenanceRecords']);
    Route::get('/maintenance-records/{record}', [FleetController::class, 'showMaintenanceRecord']);
    Route::post('/maintenance-records', [FleetController::class, 'storeMaintenanceRecord']);
    Route::put('/maintenance-records/{record}', [FleetController::class, 'updateMaintenanceRecord']);
    Route::put('/maintenance-records/{record}/verify', [FleetController::class, 'verifyMaintenance']);
    Route::put('/maintenance-records/{record}/confirm', [FleetController::class, 'confirmMaintenance']);
    Route::put('/maintenance-records/{record}/decision-close', [FleetController::class, 'decisionCloseMaintenance']);

    Route::get('/maintenance-schedules', [FleetController::class, 'schedules']);
    Route::post('/maintenance-schedules', [FleetController::class, 'storeSchedule']);
    Route::put('/maintenance-schedules/{schedule}', [FleetController::class, 'updateSchedule']);
    Route::put('/maintenance-schedules/{schedule}/complete', [FleetController::class, 'completeSchedule']);
    Route::post('/maintenance-schedules/{schedule}/restore', [FleetController::class, 'restoreSchedule']);
    Route::delete('/maintenance-schedules/{schedule}', [FleetController::class, 'deleteSchedule']);

    Route::get('/histories', [FleetController::class, 'histories']);
    Route::get('/reports', [FleetController::class, 'reports']);
    Route::get('/logs', [FleetController::class, 'logs']);

    /*
    |--------------------------------------------------------------------------
    | Maintenance Ticket Workflow Routes (Main Issue / Sub-Issue model)
    |--------------------------------------------------------------------------
    */

    // Lookups & listing
    Route::get('/tickets/lookups', [TicketController::class, 'lookups']);
    Route::get('/tickets', [TicketController::class, 'index']);
    Route::get('/tickets/{ticket}', [TicketController::class, 'show']);

    // Phase 1 — Admin: Create ticket (Main Issue) & assign to Custodian
    Route::post('/tickets', [TicketController::class, 'createTicket']);

    // Phase 2 — Custodian: Submit inspection, populate the sub-issue list
    Route::put('/tickets/{ticket}/inspect', [TicketController::class, 'submitInspection']);

    // Append a newly discovered root cause while the ticket is still Active
    Route::post('/tickets/{ticket}/sub-issues', [TicketController::class, 'addSubIssue']);

    // Phase 3 — Admin: Dispatch work order to a mechanic, per sub-issue
    Route::put('/tickets/{ticket}/sub-issues/{subIssue}/assign-mechanic', [TicketController::class, 'assignMechanic']);

    // Admin: Reassign an in-progress work order to a different mechanic
    Route::put('/tickets/{ticket}/sub-issues/{subIssue}/reassign-mechanic', [TicketController::class, 'reassignMechanic']);

    // Unsticks a ticket whose assigned Custodian became unavailable — they are
    // hard-locked as both inspector and verifier, so without this the ticket
    // is unworkable and (if still Open) not even closable.
    Route::put('/tickets/{ticket}/reassign-custodian', [TicketController::class, 'reassignCustodian']);

    // Phase 3 — Mechanic: Log physical repairs on a sub-issue
    Route::put('/tickets/{ticket}/sub-issues/{subIssue}/log-repairs', [TicketController::class, 'logRepairs']);

    // Phase 4 Tier 1 — Custodian: Verify a sub-issue's repair
    Route::put('/tickets/{ticket}/sub-issues/{subIssue}/verify', [TicketController::class, 'verifyRepair']);

    // Phase 4 Tier 2 — Admin: Confirm or rework a sub-issue
    Route::put('/tickets/{ticket}/sub-issues/{subIssue}/confirm', [TicketController::class, 'confirmSubIssue']);

    // Admin: Reopen a confirmed sub-issue (send back for re-verification)
    Route::put('/tickets/{ticket}/sub-issues/{subIssue}/reopen-confirmed', [TicketController::class, 'reopenConfirmedSubIssue']);

    // Admin: Defer a sub-issue that can't be finished now (records the
    // decision + opens a breadcrumb Issue Report so it isn't forgotten)
    Route::put('/tickets/{ticket}/sub-issues/{subIssue}/defer', [TicketController::class, 'deferSubIssue']);

    // Phase 5 — Admin: Explicit ticket closure (only once every sub-issue is Done)
    Route::put('/tickets/{ticket}/close', [TicketController::class, 'closeTicket']);

    // Admin: Cancel ticket at any stage before Closed
    Route::put('/tickets/{ticket}/cancel', [TicketController::class, 'cancelTicket']);
    Route::put('/tickets/{ticket}/uncancel', [TicketController::class, 'uncancelTicket']);

    // Admin: Delete ticket completely (in case of mistakes)
    Route::delete('/tickets/{ticket}', [TicketController::class, 'deleteTicket']);

    // Archived ticket audit log — a "Closed" entry is permanently locked, but
    // a "Deleted" entry (an accidental delete that had real progress on it)
    // can be reopened.
    Route::get('/ticket-archives', [TicketController::class, 'archives']);
    Route::put('/ticket-archives/{archive}/reopen', [TicketController::class, 'reopenArchive']);

    // Notifications API
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::put('/notifications/read-all', [NotificationController::class, 'markAllAsRead']);
    Route::put('/notifications/{notification}/read', [NotificationController::class, 'markAsRead']);
    Route::delete('/notifications/{notification}', [NotificationController::class, 'destroy']);
});
