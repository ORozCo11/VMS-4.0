<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\MaintenanceTicket;
use App\Models\TicketArchiveLog;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * TicketController — drives the entire 5-phase maintenance DFD workflow.
 *
 * Phase 1: Admin creates ticket & assigns to Custodian   → createTicket()
 * Phase 2: Custodian submits inspection result           → submitInspection()
 * Phase 3: Admin assigns mechanic (work order)           → assignMechanic()
 *          Mechanic logs repair work                     → logRepairs()
 * Phase 4: Custodian verifies repair (Tier 1)            → verifyRepair()
 *          Admin confirms or reopens (Tier 2)            → confirmTicket()
 * Phase 5: Auto-archive on Done status                   → archiveCompleted() [called internally]
 */
class TicketController extends Controller
{
    private array $priorities    = ['Low', 'Medium', 'High', 'Critical'];
    private array $maintenanceTypes = [
        'General Inspection',
        'Preventive Maintenance',
        'Engine Repair',
        'Brake Repair',
        'Tire Replacement',
        'Tire Rotation',
        'Battery Replacement',
        'Oil Change',
        'Electrical Repair',
        'Body Repair',
        'Other',
    ];

    // ===================================================================
    // READ ENDPOINTS
    // ===================================================================

    /**
     * GET /tickets — list tickets filtered by role and optional status.
     */
    public function index(Request $request)
    {
        $user  = $request->user();
        $query = MaintenanceTicket::with($this->eagerLoads());

        // Role-based scoping
        if ($user->role === 'Custodian') {
            // Custodians see tickets assigned to them
            $query->where('assigned_custodian_id', $user->id);
        }

        if ($user->role === 'Maintenance Personnel') {
            // Mechanics see tickets assigned to them
            $query->where('assigned_mechanic_id', $user->id);
        }

        // Optional filters
        $query
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->status))
            ->when($request->filled('vehicle_id'), fn ($q) => $q->where('vehicle_id', $request->vehicle_id))
            ->when($request->filled('priority'), fn ($q) => $q->where('priority', $request->priority));

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(function ($nested) use ($search) {
                $nested->where('ticket_title', 'like', "%{$search}%")
                    ->orWhere('ticket_description', 'like', "%{$search}%")
                    ->orWhereHas('vehicle', fn ($v) => $v
                        ->where('vehicle_name', 'like', "%{$search}%")
                        ->orWhere('plate_number', 'like', "%{$search}%"));
            });
        }

        return $query->latest('ticket_id')->get();
    }

    /**
     * GET /tickets/:ticket — single ticket detail view.
     */
    public function show(Request $request, MaintenanceTicket $ticket)
    {
        return $ticket->load($this->eagerLoads());
    }

    /**
     * GET /tickets/lookups — helper data for dropdowns in ticket forms.
     */
    public function lookups(Request $request)
    {
        $activeVehicleIds = MaintenanceTicket::whereNotIn('status', ['Done', 'Cancelled'])
            ->pluck('vehicle_id')
            ->toArray();

        return response()->json([
            'vehicles'               => Vehicle::where('status', '!=', 'Inactive')
                ->whereNotIn('vehicle_id', $activeVehicleIds)
                ->orderBy('vehicle_name')
                ->get(['vehicle_id', 'vehicle_name', 'plate_number', 'status', 'condition']),
            'custodians'             => User::where('role', 'Custodian')->orderBy('name')->get(['id', 'name', 'email']),
            'maintenance_personnel'  => User::where('role', 'Maintenance Personnel')->orderBy('name')->get(['id', 'name', 'email']),
            'priorities'             => $this->priorities,
            'maintenance_types'      => $this->maintenanceTypes,
            'ticket_statuses'        => ['Open', 'For Maintenance', 'Under Repair', 'For Inspection', 'For Confirmation', 'Done', 'Cancelled'],
        ]);
    }

    /**
     * GET /ticket-archives — read-only Phase 5 audit log (Admin only).
     */
    public function archives(Request $request)
    {
        $this->requireRole($request, ['Admin']);

        $query = TicketArchiveLog::with(['vehicle', 'archivedBy'])
            ->when($request->filled('vehicle_id'), fn ($q) => $q->where('vehicle_id', $request->vehicle_id));

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(function ($nested) use ($search) {
                $nested->where('ticket_title', 'like', "%{$search}%")
                    ->orWhere('vehicle_name', 'like', "%{$search}%")
                    ->orWhere('plate_number', 'like', "%{$search}%");
            });
        }

        return $query->orderByDesc('archived_at')->get();
    }

    /**
     * PUT /ticket-archives/{archive}/reopen — Reopen a ticket from archives.
     */
    public function reopenArchive(Request $request, $archiveId)
    {
        $this->requireRole($request, ['Admin']);

        $archive = TicketArchiveLog::findOrFail($archiveId);
        $ticket = MaintenanceTicket::findOrFail($archive->ticket_id);

        // Validate that this vehicle does not already have another active ticket in progress
        $activeTicketExists = MaintenanceTicket::where('vehicle_id', $ticket->vehicle_id)
            ->where('ticket_id', '!=', $ticket->ticket_id)
            ->whereNotIn('status', ['Done', 'Cancelled'])
            ->exists();

        if ($activeTicketExists) {
            return response()->json([
                'message' => 'Cannot reopen this archived ticket because the vehicle already has another active maintenance ticket in progress.'
            ], 422);
        }

        $vehicleName = $archive->vehicle_name;

        DB::transaction(function () use ($archive, $ticket, $request, $vehicleName) {
            $isNoIssues = $ticket->inspection_result === 'No Issues';

            if ($isNoIssues) {
                // Reopen to Open status so Custodian must re-inspect
                $ticket->update([
                    'status'               => 'Open',
                    'confirmation_verdict' => 'Reopened',
                    'confirmation_notes'   => 'Reopened from archives by Admin',
                    'confirmed_by'         => $request->user()->id,
                    'confirmed_at'         => now(),
                    'archived_at'          => null,
                    'inspection_result'    => null,
                    'inspection_notes'     => null,
                    'inspected_by'         => null,
                    'inspected_at'         => null,
                ]);

                // Notify Custodian of Re-inspection Requirement
                $this->notifyUser(
                    $ticket->assigned_custodian_id,
                    'Ticket Re-opened from Archives',
                    "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been reopened from archives by Admin. Please perform physical inspection again.",
                    'ticket_reopened',
                    $ticket->ticket_id
                );
            } else {
                // Reopen to Under Repair status for mechanic rework
                $ticket->update([
                    'status'               => 'Under Repair',
                    'confirmation_verdict' => 'Reopened',
                    'confirmation_notes'   => 'Reopened from archives by Admin',
                    'confirmed_by'         => $request->user()->id,
                    'confirmed_at'         => now(),
                    'archived_at'          => null,
                    // Reset verification so Custodian must re-verify
                    'verification_verdict' => null,
                    'verification_notes'   => null,
                    'verified_by'          => null,
                    'verified_at'          => null,
                    'repair_completed_at'  => null,
                ]);

                // Notify Mechanic and Custodian of Reopening
                $this->notifyUser(
                    $ticket->assigned_mechanic_id,
                    'Work Order Reopened from Archives',
                    "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been reopened from archives by Admin. Please perform repairs and log them again.",
                    'work_order_reopened',
                    $ticket->ticket_id
                );
                $this->notifyUser(
                    $ticket->assigned_custodian_id,
                    'Ticket Reopened from Archives',
                    "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been reopened from archives by Admin. Status reverted to 'Under Repair'.",
                    'ticket_reopened',
                    $ticket->ticket_id
                );
            }

            // Update vehicle status back to active maintenance if needed
            if ($isNoIssues) {
                $ticket->vehicle->update([
                    'status'    => 'Available',
                    'condition' => 'Good',
                ]);
            } else {
                $ticket->vehicle->update([
                    'status'    => 'Under Maintenance',
                    'condition' => 'Needs Repair',
                ]);
            }

            // Delete the archive entry since the ticket is active again
            $archive->delete();

            $this->log($request, 'Archive Reopened', "Archived Ticket #{$ticket->ticket_id} was reopened by Admin.");
        });

        return response()->json([
            'message' => 'Ticket reopened successfully.'
        ], 200);
    }

    // ===================================================================
    // PHASE 1 — Admin: Create Ticket & Assign to Custodian
    // ===================================================================

    /**
     * POST /tickets — Admin creates a new maintenance ticket and dispatches
     * an Inspection Assignment to the designated Custodian.
     */
    public function createTicket(Request $request)
    {
        $this->requireRole($request, ['Admin']);

        $data = $request->validate([
            'vehicle_id'            => ['required', 'exists:vehicles,vehicle_id'],
            'issue_report_id'       => ['nullable', 'exists:vehicle_issue_reports,issue_report_id'],
            'ticket_title'          => ['required', 'string', 'max:255'],
            'ticket_description'    => ['required', 'string'],
            'priority'              => ['required', Rule::in($this->priorities)],
            'assigned_custodian_id' => ['required', 'exists:users,id'],
        ]);

        // Validate that this vehicle does not already have an active ticket
        $activeTicketExists = MaintenanceTicket::where('vehicle_id', $data['vehicle_id'])
            ->whereNotIn('status', ['Done', 'Cancelled'])
            ->exists();

        if ($activeTicketExists) {
            return response()->json([
                'message' => 'This vehicle already has an active maintenance ticket in progress.'
            ], 422);
        }

        // Validate the custodian is actually a Custodian
        $custodian = User::findOrFail($data['assigned_custodian_id']);
        abort_unless($custodian->role === 'Custodian', 422, 'The selected user is not a Custodian.');

        $ticket = DB::transaction(function () use ($data, $request) {
            $vehicle = Vehicle::findOrFail($data['vehicle_id']);

            // Phase 1: Instantiate open record in the Ticket Ledger
            $ticket = MaintenanceTicket::create([
                'vehicle_id'            => $data['vehicle_id'],
                'issue_report_id'       => $data['issue_report_id'] ?? null,
                'created_by'            => $request->user()->id,
                'ticket_title'          => $data['ticket_title'],
                'ticket_description'    => $data['ticket_description'],
                'priority'              => $data['priority'],
                'status'                => 'Open',
                // Inspection Assignment payload → dispatched to Custodian
                'assigned_custodian_id' => $data['assigned_custodian_id'],
                'assigned_at'           => now(),
            ]);

            if (!empty($data['issue_report_id'])) {
                \App\Models\VehicleIssueReport::where('issue_report_id', $data['issue_report_id'])->update([
                    'status' => 'In Maintenance',
                ]);
            }

            $this->log($request, 'Create Ticket', "Ticket #{$ticket->ticket_id} created for {$vehicle->vehicle_name} and assigned to custodian.");

            $this->notifyUser(
                $ticket->assigned_custodian_id,
                'New Inspection Assignment',
                "Ticket #{$ticket->ticket_id} for {$vehicle->vehicle_name} has been assigned to you for physical inspection.",
                'inspection_assigned',
                $ticket->ticket_id
            );

            return $ticket;
        });

        return response()->json($ticket->load($this->eagerLoads()), 201);
    }

    // ===================================================================
    // PHASE 2 — Custodian: Submit Inspection Results
    // ===================================================================

    /**
     * PUT /tickets/:ticket/inspect — Custodian evaluates vehicle condition.
     * If result is 'Needs Maintenance', status becomes 'For Maintenance'
     * which triggers a Maintenance Trigger alert on Admin's dashboard.
     */
    public function submitInspection(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Custodian']);

        abort_unless(
            $ticket->assigned_custodian_id === $request->user()->id,
            403,
            'This ticket is not assigned to you.'
        );

        abort_unless(
            $ticket->status === 'Open',
            422,
            "Inspection can only be submitted when the ticket is Open. Current status: {$ticket->status}."
        );

        $data = $request->validate([
            'inspection_result' => ['required', Rule::in(['Needs Maintenance', 'No Issues'])],
            'inspection_notes'  => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($ticket, $data, $request) {
            $newStatus = $data['inspection_result'] === 'Needs Maintenance'
                ? 'For Maintenance'  // → Maintenance Trigger alert fires to Admin
                : 'For Confirmation'; // Awaiting Admin final confirmation

            $ticket->update([
                'status'            => $newStatus,
                'inspection_result' => $data['inspection_result'],
                'inspection_notes'  => $data['inspection_notes'] ?? null,
                'inspected_by'      => $request->user()->id,
                'inspected_at'      => now(),
            ]);

            // Update vehicle condition on the ledger
            if ($data['inspection_result'] === 'Needs Maintenance') {
                $ticket->vehicle->update(['condition' => 'Needs Repair']);
            }

            $this->log($request, 'Inspection Submitted', "Ticket #{$ticket->ticket_id} inspected. Result: {$data['inspection_result']}.");

            $custodianName = $request->user()->name;
            $vehicleName = $ticket->vehicle->vehicle_name;
            if ($newStatus === 'For Maintenance') {
                $this->notifyAdmins(
                    'Inspection Result: Maintenance Needed',
                    "Custodian {$custodianName} has submitted inspection for Ticket #{$ticket->ticket_id} ({$vehicleName}). Status updated to 'For Maintenance'. Please assign a mechanic.",
                    'inspection_submitted',
                    $ticket->ticket_id
                );
            } else {
                $this->notifyAdmins(
                    'Inspection Result: No Issues',
                    "Custodian {$custodianName} has submitted inspection for Ticket #{$ticket->ticket_id} ({$vehicleName}). Result is 'No Issues' (Awaiting final confirmation).",
                    'inspection_submitted',
                    $ticket->ticket_id
                );
            }
        });

        return $ticket->fresh($this->eagerLoads());
    }

    // ===================================================================
    // PHASE 3 — Admin: Assign Mechanic (Work Order Dispatch)
    // ===================================================================

    /**
     * PUT /tickets/:ticket/assign-mechanic — Admin assigns a mechanic after
     * the Maintenance Trigger alert. Compiles a Work Order and dispatches it
     * to the Maintenance Personnel entity.
     */
    public function assignMechanic(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless(
            $ticket->status === 'For Maintenance',
            422,
            "A mechanic can only be assigned when ticket status is 'For Maintenance'. Current: {$ticket->status}."
        );

        $data = $request->validate([
            'assigned_mechanic_id' => ['required', 'exists:users,id'],
            'maintenance_type'     => ['required', Rule::in($this->maintenanceTypes)],
            'work_order_notes'     => ['nullable', 'string'],
        ]);

        $mechanic = User::findOrFail($data['assigned_mechanic_id']);
        abort_unless($mechanic->role === 'Maintenance Personnel', 422, 'The selected user is not Maintenance Personnel.');

        DB::transaction(function () use ($ticket, $data, $request) {
            $ticket->update([
                'status'                => 'Under Repair',
                'assigned_mechanic_id'  => $data['assigned_mechanic_id'],
                'maintenance_type'      => $data['maintenance_type'],
                'work_order_notes'      => $data['work_order_notes'] ?? null,
                'mechanic_assigned_at'  => now(),
                'mechanic_assigned_by'  => $request->user()->id,
            ]);

            // Vehicle is now formally Under Maintenance
            $ticket->vehicle->update(['status' => 'Under Maintenance']);

            $this->log($request, 'Mechanic Assigned', "Ticket #{$ticket->ticket_id} — work order dispatched to mechanic ID {$data['assigned_mechanic_id']}.");

            $vehicleName = $ticket->vehicle->vehicle_name;
            $this->notifyUser(
                $data['assigned_mechanic_id'],
                'New Work Order Assigned',
                "You have been assigned to Ticket #{$ticket->ticket_id} ({$vehicleName}) for repair work order.",
                'work_order_assigned',
                $ticket->ticket_id
            );
        });

        return $ticket->fresh($this->eagerLoads());
    }

    // ===================================================================
    // PHASE 3 — Mechanic: Log Physical Repairs
    // ===================================================================

    /**
     * PUT /tickets/:ticket/log-repairs — Mechanic streams Repair Logs.
     * Sets status to 'For Inspection' so Custodian gets the verification request.
     */
    public function logRepairs(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Maintenance Personnel']);

        abort_unless(
            $ticket->assigned_mechanic_id === $request->user()->id,
            403,
            'This work order is not assigned to you.'
        );

        abort_unless(
            $ticket->status === 'Under Repair',
            422,
            "Repairs can only be logged when status is 'Under Repair'. Current: {$ticket->status}."
        );

        $data = $request->validate([
            'repair_logs'         => ['required', 'string'],
            'parts_used'          => ['nullable', 'string'],
            'repair_started_at'   => ['nullable', 'date'],
            'repair_completed_at' => ['nullable', 'date'],
            'maintenance_cost'    => ['nullable', 'numeric', 'min:0'],
        ]);

        DB::transaction(function () use ($ticket, $data, $request) {
            // Appends to repair log so mechanic can update multiple times
            $existingLogs = $ticket->repair_logs ? $ticket->repair_logs . "\n\n" : '';

            $ticket->update([
                'status'              => 'For Inspection', // Triggers Custodian Inspection Request
                'repair_logs'         => $existingLogs . '[' . now()->format('Y-m-d H:i') . '] ' . $data['repair_logs'],
                'parts_used'          => $data['parts_used'] ?? $ticket->parts_used,
                'repair_started_at'   => $data['repair_started_at'] ?? $ticket->repair_started_at,
                'repair_completed_at' => $data['repair_completed_at'] ?? null,
                'maintenance_cost'    => $data['maintenance_cost'] ?? $ticket->maintenance_cost,
            ]);

            $this->log($request, 'Repairs Logged', "Ticket #{$ticket->ticket_id} — repair logs submitted. Status → For Inspection.");

            $mechanicName = $request->user()->name;
            $vehicleName = $ticket->vehicle->vehicle_name;
            $this->notifyUser(
                $ticket->assigned_custodian_id,
                'Verification Required: Repairs Completed',
                "Mechanic {$mechanicName} has logged repair works for Ticket #{$ticket->ticket_id} ({$vehicleName}). Action required: Please inspect and verify repairs.",
                'repairs_completed',
                $ticket->ticket_id
            );
        });

        return $ticket->fresh($this->eagerLoads());
    }

    // ===================================================================
    // PHASE 4 Tier 1 — Custodian: Verify Repair Integrity
    // ===================================================================

    /**
     * PUT /tickets/:ticket/verify — Custodian inspects the completed repair.
     * Approved → status becomes 'For Confirmation' (Admin review).
     * Rejected → feedback loop fires: status reverts to 'Under Repair' (back to Phase 3).
     */
    public function verifyRepair(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Custodian']);

        abort_unless(
            $ticket->assigned_custodian_id === $request->user()->id,
            403,
            'This ticket is not assigned to you.'
        );

        abort_unless(
            $ticket->status === 'For Inspection',
            422,
            "Verification can only be submitted when status is 'For Inspection'. Current: {$ticket->status}."
        );

        $data = $request->validate([
            'verification_verdict' => ['required', Rule::in(['Approved', 'Rejected'])],
            'verification_notes'   => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($ticket, $data, $request) {
            $approved  = $data['verification_verdict'] === 'Approved';

            // Tier 1 outcome:
            // Approved → Update: For Confirmation (moves to Admin Tier 2)
            // Rejected → Ticket Reopen (Status: Under Repair) — feedback loop to Phase 3
            $ticket->update([
                'status'               => $approved ? 'For Confirmation' : 'Under Repair',
                'verification_verdict' => $data['verification_verdict'],
                'verification_notes'   => $data['verification_notes'] ?? null,
                'verified_by'          => $request->user()->id,
                'verified_at'          => now(),
                // Reset on rejection so mechanic can re-log
                'repair_completed_at'  => $approved ? $ticket->repair_completed_at : null,
            ]);

            $this->log($request, 'Repair Verified', "Ticket #{$ticket->ticket_id} verification: {$data['verification_verdict']}. Status → " . ($approved ? 'For Confirmation' : 'Under Repair (reopened).'));

            $custodianName = $request->user()->name;
            $vehicleName = $ticket->vehicle->vehicle_name;
            if ($approved) {
                $this->notifyAdmins(
                    'Repairs Approved by Custodian',
                    "Custodian {$custodianName} has approved the repairs on Ticket #{$ticket->ticket_id} ({$vehicleName}). Action required: Please review and submit final confirmation.",
                    'repairs_approved',
                    $ticket->ticket_id
                );
            } else {
                $this->notifyUser(
                    $ticket->assigned_mechanic_id,
                    'Work Order Rejected',
                    "Custodian {$custodianName} has rejected your repair logs for Ticket #{$ticket->ticket_id} ({$vehicleName}). Action required: Please review the notes and re-perform repairs.",
                    'repairs_rejected',
                    $ticket->ticket_id
                );
            }
        });

        return $ticket->fresh($this->eagerLoads());
    }

    // ===================================================================
    // PHASE 4 Tier 2 — Admin: Confirm Ticket Closure
    // ===================================================================

    /**
     * PUT /tickets/:ticket/confirm — Admin reviews Custodian-approved repair.
     * Confirmed  → Update Status: Done → triggers Phase 5 archive.
     * Reopened   → Ticket Reopen (Status: Open) → fallback loop to Phase 3.
     */
    public function confirmTicket(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless(
            $ticket->status === 'For Confirmation',
            422,
            "Ticket can only be confirmed when status is 'For Confirmation'. Current: {$ticket->status}."
        );

        $data = $request->validate([
            'confirmation_verdict' => ['required', Rule::in(['Confirmed', 'Reopened'])],
            'confirmation_notes'   => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($ticket, $data, $request) {
            $confirmed = $data['confirmation_verdict'] === 'Confirmed';
            $vehicleName = $ticket->vehicle->vehicle_name;

            if ($confirmed) {
                // Phase 4 Tier 2: Update Status: Done
                $ticket->update([
                    'status'               => 'Done',
                    'confirmation_verdict' => 'Confirmed',
                    'confirmation_notes'   => $data['confirmation_notes'] ?? null,
                    'confirmed_by'         => $request->user()->id,
                    'confirmed_at'         => now(),
                    'archived_at'          => now(),
                ]);

                // Vehicle returns to service
                $ticket->vehicle->update([
                    'status'    => 'Available',
                    'condition' => 'Good',
                ]);

                if ($ticket->issue_report_id) {
                    \App\Models\VehicleIssueReport::where('issue_report_id', $ticket->issue_report_id)->update([
                        'status' => 'Resolved',
                    ]);
                }

                $this->log($request, 'Ticket Confirmed', "Ticket #{$ticket->ticket_id} confirmed Done. Vehicle returned to service.");

                // Phase 5: Archive the completed ticket
                $this->archiveCompleted($ticket->fresh(), $request->user()->id);

                // Unify Ledger: Automatically record completed ticket in vehicle_maintenance_records
                if ($ticket->assigned_mechanic_id) {
                    \App\Models\VehicleMaintenanceRecord::create([
                        'vehicle_id'               => $ticket->vehicle_id,
                        'issue_report_id'          => $ticket->issue_report_id,
                        'maintenance_type'         => $ticket->maintenance_type ?? 'Repair',
                        'problem_reason'           => $ticket->ticket_title . ': ' . $ticket->ticket_description,
                        'date_started'             => $ticket->repair_started_at,
                        'date_completed'           => $ticket->repair_completed_at ?? now()->toDateString(),
                        'maintenance_personnel_id' => $ticket->assigned_mechanic_id,
                        'action_taken'             => $ticket->repair_logs ?? 'No logs provided.',
                        'parts_used'               => $ticket->parts_used,
                        'maintenance_cost'         => $ticket->maintenance_cost,
                        'progress_status'          => 'Completed',
                        'remarks'                  => $ticket->confirmation_notes ?? 'Confirmed through Ticket #' . $ticket->ticket_id,
                        'verification_result'      => 'Passed',
                        'verification_notes'       => $ticket->verification_notes,
                        'verified_by'              => $ticket->verified_by,
                        'verified_at'              => $ticket->verified_at,
                        'confirmed_by'             => $ticket->confirmed_by,
                        'confirmed_at'             => $ticket->confirmed_at,
                    ]);
                }

                // Notify Custodian and Mechanic of Closure
                $this->notifyUser(
                    $ticket->assigned_custodian_id,
                    'Ticket Closed & Confirmed',
                    "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been confirmed and closed by Admin. Vehicle is now Available.",
                    'ticket_closed',
                    $ticket->ticket_id
                );
                $this->notifyUser(
                    $ticket->assigned_mechanic_id,
                    'Ticket Closed & Confirmed',
                    "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been confirmed and closed by Admin. Vehicle is now Available.",
                    'ticket_closed',
                    $ticket->ticket_id
                );

            } else {
                $isNoIssues = $ticket->inspection_result === 'No Issues';

                if ($isNoIssues) {
                    // Reopen to Open status so Custodian must re-inspect
                    $ticket->update([
                        'status'               => 'Open',
                        'confirmation_verdict' => 'Reopened',
                        'confirmation_notes'   => $data['confirmation_notes'] ?? null,
                        'confirmed_by'         => $request->user()->id,
                        'confirmed_at'         => now(),
                        'inspection_result'    => null,
                        'inspection_notes'     => null,
                        'inspected_by'         => null,
                        'inspected_at'         => null,
                    ]);

                    $this->log($request, 'Ticket Reopened', "Ticket #{$ticket->ticket_id} reopened by Admin (No Issues verdict rejected). Custodian must re-inspect.");

                    // Notify Custodian of Re-inspection Requirement
                    $this->notifyUser(
                        $ticket->assigned_custodian_id,
                        'Ticket Re-opened: Inspection Required',
                        "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been reopened by Admin. Please perform physical inspection again.",
                        'ticket_reopened',
                        $ticket->ticket_id
                    );
                } else {
                    // Fallback loop: Ticket Reopen (Status: Under Repair) → mechanic must re-work
                    $ticket->update([
                        'status'               => 'Under Repair',
                        'confirmation_verdict' => 'Reopened',
                        'confirmation_notes'   => $data['confirmation_notes'] ?? null,
                        'confirmed_by'         => $request->user()->id,
                        'confirmed_at'         => now(),
                        // Reset verification so Custodian must re-verify
                        'verification_verdict' => null,
                        'verification_notes'   => null,
                        'verified_by'          => null,
                        'verified_at'          => null,
                        'repair_completed_at'  => null,
                    ]);

                    $this->log($request, 'Ticket Reopened', "Ticket #{$ticket->ticket_id} reopened by Admin. Mechanic must re-submit repairs.");

                    // Notify Mechanic and Custodian of Reopening
                    $this->notifyUser(
                        $ticket->assigned_mechanic_id,
                        'Work Order Reopened',
                        "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been reopened by Admin. Action required: Please perform repairs and log them again.",
                        'work_order_reopened',
                        $ticket->ticket_id
                    );
                    $this->notifyUser(
                        $ticket->assigned_custodian_id,
                        'Ticket Reopened by Admin',
                        "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been reopened by Admin. Status reverted to 'Under Repair'.",
                        'ticket_reopened',
                        $ticket->ticket_id
                    );
                }
            }
        });

        return $ticket->fresh($this->eagerLoads());
    }

    /**
     * PUT /tickets/:ticket/cancel — Admin cancels a ticket at any stage.
     */
    public function cancelTicket(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        $data = $request->validate([
            'confirmation_notes' => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($ticket, $data, $request) {
            $ticket->update([
                'status'             => 'Cancelled',
                'confirmation_notes' => $data['confirmation_notes'] ?? null,
            ]);

            if ($ticket->issue_report_id) {
                \App\Models\VehicleIssueReport::where('issue_report_id', $ticket->issue_report_id)->update([
                    'status' => 'Pending',
                ]);
            }

            $this->log($request, 'Ticket Cancelled', "Ticket #{$ticket->ticket_id} was cancelled by admin.");
        });

        return $ticket->fresh($this->eagerLoads());
    }

    /**
     * PUT /tickets/:ticket/uncancel — Admin restores a cancelled ticket back to its previous status.
     */
    public function uncancelTicket(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless(
            $ticket->status === 'Cancelled',
            422,
            "Only cancelled tickets can be restored."
        );

        $restoredStatus = 'Open';

        if ($ticket->verified_at || $ticket->verification_verdict) {
            $restoredStatus = $ticket->verification_verdict === 'Approved' ? 'For Confirmation' : 'Under Repair';
        } elseif ($ticket->repair_completed_at || $ticket->repair_logs) {
            $restoredStatus = 'For Inspection';
        } elseif ($ticket->assigned_mechanic_id || $ticket->mechanic_assigned_at) {
            $restoredStatus = 'Under Repair';
        } elseif ($ticket->inspected_at || $ticket->inspection_result) {
            $restoredStatus = $ticket->inspection_result === 'Needs Maintenance' ? 'For Maintenance' : 'For Confirmation';
        }

        DB::transaction(function () use ($ticket, $restoredStatus, $request) {
            $ticket->update([
                'status' => $restoredStatus,
                'confirmation_notes' => null,
            ]);

            // Also make sure vehicle is in the correct status
            $vehicleStatus = 'Available';
            if (in_array($restoredStatus, ['For Maintenance', 'Under Repair', 'For Inspection'])) {
                $vehicleStatus = 'Under Maintenance';
            }
            $ticket->vehicle->update(['status' => $vehicleStatus]);

            if ($ticket->issue_report_id) {
                \App\Models\VehicleIssueReport::where('issue_report_id', $ticket->issue_report_id)->update([
                    'status' => 'In Maintenance',
                ]);
            }

            $this->log($request, 'Ticket Restored', "Ticket #{$ticket->ticket_id} was restored back to state '{$restoredStatus}' by Admin.");
        });

        return $ticket->fresh($this->eagerLoads());
    }

    /**
     * DELETE /tickets/:ticket — Admin deletes a ticket completely.
     */
    public function deleteTicket(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        DB::transaction(function () use ($ticket, $request) {
            $vehicle = $ticket->vehicle;

            if ($vehicle) {
                // Return vehicle to safe state if it was locked in maintenance by this ticket
                $vehicle->update([
                    'status'    => 'Available',
                    'condition' => 'Good',
                ]);
            }

            if ($ticket->issue_report_id) {
                \App\Models\VehicleIssueReport::where('issue_report_id', $ticket->issue_report_id)->update([
                    'status' => 'Pending',
                ]);
            }

            $ticket->delete();

            $this->log($request, 'Delete Ticket', "Ticket #{$ticket->ticket_id} was deleted by Admin.");
        });

        return response()->json([
            'message' => 'Ticket deleted successfully.'
        ], 200);
    }

    // ===================================================================
    // PHASE 5 — History Logging & Archive Auditing (internal)
    // ===================================================================

    /**
     * Captures completed ticket data and commits an immutable Archived Log
     * Entry into the ticket_archive_logs repository.
     */
    private function archiveCompleted(MaintenanceTicket $ticket, int $userId): void
    {
        $vehicle = $ticket->vehicle;

        TicketArchiveLog::create([
            'ticket_id'            => $ticket->ticket_id,
            'vehicle_id'           => $ticket->vehicle_id,
            'ticket_title'         => $ticket->ticket_title,
            'vehicle_name'         => $vehicle->vehicle_name,
            'plate_number'         => $vehicle->plate_number,
            'maintenance_cost'     => $ticket->maintenance_cost,
            'final_status'         => $ticket->status,
            'full_ticket_snapshot' => $ticket->toArray(),
            'archived_by'          => $userId,
            'archived_at'          => now(),
        ]);
    }

    // ===================================================================
    // Helpers
    // ===================================================================

    private function eagerLoads(): array
    {
        return [
            'vehicle',
            'issueReport',
            'createdBy',
            'assignedCustodian',
            'inspectedBy',
            'assignedMechanic',
            'mechanicAssignedBy',
            'verifiedBy',
            'confirmedBy',
        ];
    }

    private function log(Request $request, string $action, string $details): void
    {
        ActivityLog::create([
            'user_id' => $request->user()?->id,
            'role'    => $request->user()?->role,
            'action'  => $action,
            'module'  => 'Maintenance Tickets',
            'details' => $details,
        ]);
    }

    private function requireRole(Request $request, array $roles): void
    {
        abort_unless(in_array($request->user()->role, $roles, true), 403, 'Your account role cannot perform this action.');
    }

    private function notifyUser($userId, $title, $message, $type, $ticketId)
    {
        if (!$userId) return;
        \App\Models\Notification::create([
            'user_id'   => $userId,
            'title'     => $title,
            'message'   => $message,
            'type'      => $type,
            'ticket_id' => $ticketId,
        ]);
    }

    private function notifyAdmins($title, $message, $type, $ticketId)
    {
        $admins = \App\Models\User::where('role', 'Admin')->get();
        foreach ($admins as $admin) {
            $this->notifyUser($admin->id, $title, $message, $type, $ticketId);
        }
    }
}
