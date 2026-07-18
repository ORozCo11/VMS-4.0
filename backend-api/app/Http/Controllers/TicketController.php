<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\UploadsImages;
use App\Models\ActivityLog;
use App\Models\MaintenanceTicket;
use App\Models\TicketArchiveLog;
use App\Models\TicketSubIssue;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleIssueReport;
use App\Models\VehicleMaintenanceRecord;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * TicketController — drives the Main Issue / Sub-Issue maintenance workflow.
 *
 * A ticket is a Main Issue container (e.g. "Overheating"). During inspection
 * it's populated with one or more Sub-Issues (e.g. "low coolant level"),
 * each running its own independent pipeline with its own mechanic:
 *
 *   Open -> Under Repair -> For Inspection -> For Confirmation -> Done
 *
 * The ticket's progress is X/N sub-issues Done. New sub-issues can be
 * appended for as long as the ticket is Active. Once an Admin explicitly
 * Closes the ticket (only allowed at N/N), it is permanently locked — no
 * further sub-issues, no reopening, ever.
 *
 * Phase 1: Admin creates ticket & assigns to Custodian   -> createTicket()
 * Phase 2: Custodian inspects, populates sub-issues       -> submitInspection()
 *          A new sub-issue can be added later             -> addSubIssue()
 * Phase 3: Admin assigns a mechanic per sub-issue          -> assignMechanic()
 *          Mechanic logs repair per sub-issue              -> logRepairs()
 * Phase 4: Custodian verifies a sub-issue (Tier 1)         -> verifyRepair()
 *          Admin confirms or reworks a sub-issue (Tier 2)  -> confirmSubIssue()
 * Phase 5: Admin explicitly closes the ticket (N/N only)   -> closeTicket()
 */
class TicketController extends Controller
{
    use UploadsImages;

    private array $priorities       = ['Low', 'Medium', 'High', 'Critical'];
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

    public function index(Request $request)
    {
        $user  = $request->user();
        $query = MaintenanceTicket::with($this->eagerLoads());

        if ($user->role === 'Custodian') {
            $query->where('assigned_custodian_id', $user->id);
        }

        if ($user->role === 'Maintenance Personnel') {
            $query->whereHas('subIssues', fn ($q) => $q->where('assigned_mechanic_id', $user->id));
        }

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

    public function show(Request $request, MaintenanceTicket $ticket)
    {
        return $ticket->load($this->eagerLoads());
    }

    public function lookups(Request $request)
    {
        return response()->json([
            'vehicles'              => Vehicle::where('status', '!=', 'Inactive')
                ->orderBy('vehicle_name')
                ->get(['vehicle_id', 'vehicle_name', 'plate_number', 'status', 'condition']),
            'custodians'            => User::where('role', 'Custodian')->orderBy('name')->get(['id', 'name', 'email']),
            'maintenance_personnel' => User::where('role', 'Maintenance Personnel')->orderBy('name')->get(['id', 'name', 'email']),
            'priorities'            => $this->priorities,
            'maintenance_types'     => $this->maintenanceTypes,
            'ticket_statuses'       => ['Open', 'Active', 'Closed', 'Cancelled'],
            'sub_issue_statuses'    => ['Open', 'Under Repair', 'For Inspection', 'For Confirmation', 'Done'],
        ]);
    }

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

    // ===================================================================
    // PHASE 1 — Admin: Create Ticket (Main Issue) & Assign to Custodian
    // ===================================================================

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

        // A brand-new ticket is only blocked when an open ticket for the
        // SAME Main Issue already exists on this vehicle — a different
        // Main Issue (or a Closed/Cancelled ticket for the same one) is
        // always allowed to open as its own ticket.
        $duplicateMainIssue = MaintenanceTicket::where('vehicle_id', $data['vehicle_id'])
            ->whereRaw('LOWER(TRIM(ticket_title)) = ?', [mb_strtolower(trim($data['ticket_title']))])
            ->whereNotIn('status', ['Closed', 'Cancelled'])
            ->first();

        if ($duplicateMainIssue) {
            return response()->json([
                'message' => "This vehicle already has an open ticket for \"{$data['ticket_title']}\" (Ticket #{$duplicateMainIssue->ticket_id}). Add this as a sub-issue on that ticket instead of opening a new one."
            ], 422);
        }

        $custodian = User::findOrFail($data['assigned_custodian_id']);
        abort_unless($custodian->role === 'Custodian', 422, 'The selected user is not a Custodian.');

        $ticket = DB::transaction(function () use ($data, $request) {
            $vehicle = Vehicle::findOrFail($data['vehicle_id']);

            $ticket = MaintenanceTicket::create([
                'vehicle_id'            => $data['vehicle_id'],
                'issue_report_id'       => $data['issue_report_id'] ?? null,
                'created_by'            => $request->user()->id,
                'ticket_title'          => $data['ticket_title'],
                'ticket_description'    => $data['ticket_description'],
                'priority'              => $data['priority'],
                'status'                => 'Open',
                'assigned_custodian_id' => $data['assigned_custodian_id'],
                'assigned_at'           => now(),
            ]);

            if (!empty($data['issue_report_id'])) {
                VehicleIssueReport::where('issue_report_id', $data['issue_report_id'])->update([
                    'status' => 'In Maintenance',
                ]);
            }

            $this->log($request, 'Create Ticket', "Ticket #{$ticket->ticket_id} ({$data['ticket_title']}) created for {$vehicle->vehicle_name} and assigned to custodian.");

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
    // PHASE 2 — Custodian: Submit Inspection, Populate Sub-Issues
    // ===================================================================

    public function submitInspection(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Custodian']);

        abort_unless($ticket->assigned_custodian_id === $request->user()->id, 403, 'This ticket is not assigned to you.');
        abort_unless($ticket->status === 'Open', 422, "Inspection can only be submitted when the ticket is Open. Current status: {$ticket->status}.");

        $data = $request->validate([
            'inspection_result'             => ['required', Rule::in(['Needs Maintenance', 'No Issues'])],
            'inspection_notes'               => ['nullable', 'string'],
            'sub_issues'                     => ['required_if:inspection_result,Needs Maintenance', 'array', 'min:1'],
            'sub_issues.*.title'             => ['required_with:sub_issues', 'string', 'max:255'],
            'sub_issues.*.maintenance_type'  => ['nullable', Rule::in($this->maintenanceTypes)],
        ]);

        DB::transaction(function () use ($ticket, $data, $request) {
            $ticket->update([
                'status'            => 'Active',
                'inspection_result' => $data['inspection_result'],
                'inspection_notes'  => $data['inspection_notes'] ?? null,
                'inspected_by'      => $request->user()->id,
                'inspected_at'      => now(),
            ]);

            if ($data['inspection_result'] === 'Needs Maintenance') {
                foreach ($data['sub_issues'] as $subIssue) {
                    TicketSubIssue::create([
                        'ticket_id'        => $ticket->ticket_id,
                        'created_by'       => $request->user()->id,
                        'title'            => $subIssue['title'],
                        'maintenance_type' => $subIssue['maintenance_type'] ?? null,
                        'status'           => 'Open',
                    ]);
                }
                // Status and condition move together — the moment the
                // Custodian confirms a real problem, the vehicle is no
                // longer available for dispatch, regardless of whether a
                // mechanic has been assigned yet.
                $ticket->vehicle->update([
                    'condition' => 'Needs Repair',
                    'status'    => 'Under Maintenance',
                ]);
            } elseif ($ticket->vehicle->condition !== 'Good') {
                // "No Issues" clears whatever flagged this vehicle for
                // inspection in the first place — don't leave it reading
                // Needs Inspection after it's just been cleared.
                $ticket->vehicle->update(['condition' => 'Good']);
            }

            $count = $data['inspection_result'] === 'Needs Maintenance' ? count($data['sub_issues']) : 0;
            $this->log($request, 'Inspection Submitted', "Ticket #{$ticket->ticket_id} inspected. Result: {$data['inspection_result']}" . ($count ? " ({$count} sub-issue(s) logged)." : '.'));

            $vehicleName = $ticket->vehicle->vehicle_name;
            $custodianName = $request->user()->name;
            $this->notifyAdmins(
                'Inspection Submitted',
                "Custodian {$custodianName} submitted inspection for Ticket #{$ticket->ticket_id} ({$vehicleName}). Result: {$data['inspection_result']}.",
                'inspection_submitted',
                $ticket->ticket_id
            );
        });

        return $ticket->fresh($this->eagerLoads());
    }

    /**
     * PUT /tickets/:ticket/sub-issues — append a newly discovered root
     * cause to a still-Active ticket. Once the ticket is Closed, this is
     * never available — a new issue at that point must open a fresh ticket.
     */
    public function addSubIssue(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin', 'Custodian']);

        if ($request->user()->role === 'Custodian') {
            abort_unless($ticket->assigned_custodian_id === $request->user()->id, 403, 'This ticket is not assigned to you.');
        }

        abort_unless($ticket->status === 'Active', 422, "Sub-issues can only be added while the ticket is Active. Current status: {$ticket->status}.");

        $data = $request->validate([
            'title'            => ['required', 'string', 'max:255'],
            'maintenance_type' => ['nullable', Rule::in($this->maintenanceTypes)],
            'issue_report_id'  => ['nullable', 'exists:vehicle_issue_reports,issue_report_id'],
        ]);

        $subIssue = DB::transaction(function () use ($ticket, $data, $request) {
            $subIssue = TicketSubIssue::create([
                'ticket_id'        => $ticket->ticket_id,
                'issue_report_id'  => $data['issue_report_id'] ?? null,
                'created_by'       => $request->user()->id,
                'title'            => $data['title'],
                'maintenance_type' => $data['maintenance_type'] ?? null,
                'status'           => 'Open',
            ]);

            if (!empty($data['issue_report_id'])) {
                VehicleIssueReport::where('issue_report_id', $data['issue_report_id'])->update(['status' => 'In Maintenance']);
            }

            $progress = $ticket->fresh()->progress;
            $this->log($request, 'Sub-Issue Added', "Ticket #{$ticket->ticket_id} — sub-issue \"{$data['title']}\" added. Progress {$progress['done']}/{$progress['total']}.");

            return $subIssue;
        });

        return response()->json($subIssue, 201);
    }

    // ===================================================================
    // PHASE 3 — Admin: Assign Mechanic to a Sub-Issue (Work Order)
    // ===================================================================

    public function assignMechanic(Request $request, MaintenanceTicket $ticket, TicketSubIssue $subIssue)
    {
        $this->requireRole($request, ['Admin']);
        $this->assertBelongsToTicket($ticket, $subIssue);

        abort_unless($subIssue->status === 'Open', 422, "A mechanic can only be assigned when the sub-issue is Open. Current: {$subIssue->status}.");

        $data = $request->validate([
            'assigned_mechanic_id' => ['required', 'exists:users,id'],
            'maintenance_type'     => ['required', Rule::in($this->maintenanceTypes)],
            'work_order_notes'     => ['nullable', 'string'],
        ]);

        $mechanic = User::findOrFail($data['assigned_mechanic_id']);
        abort_unless($mechanic->role === 'Maintenance Personnel', 422, 'The selected user is not Maintenance Personnel.');

        DB::transaction(function () use ($ticket, $subIssue, $data, $request) {
            $subIssue->update([
                'status'               => 'Under Repair',
                'assigned_mechanic_id' => $data['assigned_mechanic_id'],
                'maintenance_type'     => $data['maintenance_type'],
                'work_order_notes'     => $data['work_order_notes'] ?? null,
                'mechanic_assigned_at' => now(),
                'mechanic_assigned_by' => $request->user()->id,
            ]);

            $this->recomputeVehicleStatus($ticket->vehicle_id);

            $this->log($request, 'Mechanic Assigned', "Ticket #{$ticket->ticket_id} — sub-issue \"{$subIssue->title}\" assigned to mechanic ID {$data['assigned_mechanic_id']}.");

            $vehicleName = $ticket->vehicle->vehicle_name;
            $this->notifyUser(
                $data['assigned_mechanic_id'],
                'New Work Order Assigned',
                "You have been assigned to \"{$subIssue->title}\" on Ticket #{$ticket->ticket_id} ({$vehicleName}).",
                'work_order_assigned',
                $ticket->ticket_id
            );
        });

        return $subIssue->fresh();
    }

    // ===================================================================
    // PHASE 3 — Mechanic: Log Repair on a Sub-Issue
    // ===================================================================

    public function logRepairs(Request $request, MaintenanceTicket $ticket, TicketSubIssue $subIssue)
    {
        $this->requireRole($request, ['Maintenance Personnel']);
        $this->assertBelongsToTicket($ticket, $subIssue);

        abort_unless($subIssue->assigned_mechanic_id === $request->user()->id, 403, 'This work order is not assigned to you.');
        abort_unless($subIssue->status === 'Under Repair', 422, "Repairs can only be logged when the sub-issue is Under Repair. Current: {$subIssue->status}.");

        $data = $request->validate([
            'repair_logs'           => ['required', 'string'],
            'parts_used'            => ['nullable', 'string'],
            'photo'                 => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf,doc,docx', 'max:8192'],
            'repair_started_at'     => ['nullable', 'date'],
            'repair_completed_at'   => ['nullable', 'date'],
            'maintenance_cost'      => ['nullable', 'numeric', 'min:0'],
            'estimated_return_date' => ['nullable', 'date'],
        ]);

        DB::transaction(function () use ($ticket, $subIssue, $data, $request) {
            $existingLogs = $subIssue->repair_logs ? $subIssue->repair_logs . "\n\n" : '';

            $subIssue->update([
                'status'              => 'For Inspection',
                'repair_logs'         => $existingLogs . '[' . now()->format('Y-m-d H:i') . '] ' . $data['repair_logs'],
                'parts_used'          => $data['parts_used'] ?? $subIssue->parts_used,
                'attachment_url'      => $request->hasFile('photo')
                    ? $this->storeUploadedImage($request->file('photo'), 'repair-attachments')
                    : $subIssue->attachment_url,
                'repair_started_at'   => $data['repair_started_at'] ?? $subIssue->repair_started_at,
                'repair_completed_at' => $data['repair_completed_at'] ?? null,
                'maintenance_cost'    => $data['maintenance_cost'] ?? $subIssue->maintenance_cost,
            ]);

            if (array_key_exists('estimated_return_date', $data) && $data['estimated_return_date']) {
                $ticket->vehicle->update(['estimated_return_date' => $data['estimated_return_date']]);
            }

            $this->log($request, 'Repairs Logged', "Ticket #{$ticket->ticket_id} — sub-issue \"{$subIssue->title}\" repair logs submitted.");

            $mechanicName = $request->user()->name;
            $vehicleName = $ticket->vehicle->vehicle_name;
            $this->notifyUser(
                $ticket->assigned_custodian_id,
                'Verification Required: Repairs Completed',
                "Mechanic {$mechanicName} logged repair work for \"{$subIssue->title}\" on Ticket #{$ticket->ticket_id} ({$vehicleName}). Please verify.",
                'repairs_completed',
                $ticket->ticket_id
            );
        });

        return $subIssue->fresh();
    }

    // ===================================================================
    // PHASE 4 Tier 1 — Custodian: Verify a Sub-Issue's Repair
    // ===================================================================

    public function verifyRepair(Request $request, MaintenanceTicket $ticket, TicketSubIssue $subIssue)
    {
        $this->requireRole($request, ['Custodian']);
        $this->assertBelongsToTicket($ticket, $subIssue);

        abort_unless($ticket->assigned_custodian_id === $request->user()->id, 403, 'This ticket is not assigned to you.');
        abort_unless($subIssue->status === 'For Inspection', 422, "Verification can only be submitted when the sub-issue is For Inspection. Current: {$subIssue->status}.");

        $data = $request->validate([
            'verification_verdict' => ['required', Rule::in(['Approved', 'Rejected'])],
            'verification_notes'   => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($ticket, $subIssue, $data, $request) {
            $approved = $data['verification_verdict'] === 'Approved';

            $subIssue->update([
                'status'               => $approved ? 'For Confirmation' : 'Under Repair',
                'verification_verdict' => $data['verification_verdict'],
                'verification_notes'   => $data['verification_notes'] ?? null,
                'verified_by'          => $request->user()->id,
                'verified_at'          => now(),
                'repair_completed_at'  => $approved ? $subIssue->repair_completed_at : null,
            ]);

            $this->log($request, 'Repair Verified', "Ticket #{$ticket->ticket_id} — sub-issue \"{$subIssue->title}\" verification: {$data['verification_verdict']}.");

            $custodianName = $request->user()->name;
            $vehicleName = $ticket->vehicle->vehicle_name;
            if ($approved) {
                $this->notifyAdmins(
                    'Repairs Approved by Custodian',
                    "Custodian {$custodianName} approved \"{$subIssue->title}\" on Ticket #{$ticket->ticket_id} ({$vehicleName}). Please give final confirmation.",
                    'repairs_approved',
                    $ticket->ticket_id
                );
            } else {
                $this->notifyUser(
                    $subIssue->assigned_mechanic_id,
                    'Work Order Rejected',
                    "Custodian {$custodianName} rejected \"{$subIssue->title}\" on Ticket #{$ticket->ticket_id} ({$vehicleName}). Please re-perform repairs.",
                    'repairs_rejected',
                    $ticket->ticket_id
                );
            }
        });

        return $subIssue->fresh();
    }

    // ===================================================================
    // PHASE 4 Tier 2 — Admin: Confirm (or Rework) a Sub-Issue
    // ===================================================================

    public function confirmSubIssue(Request $request, MaintenanceTicket $ticket, TicketSubIssue $subIssue)
    {
        $this->requireRole($request, ['Admin']);
        $this->assertBelongsToTicket($ticket, $subIssue);

        abort_unless($subIssue->status === 'For Confirmation', 422, "A sub-issue can only be confirmed when it is For Confirmation. Current: {$subIssue->status}.");

        $data = $request->validate([
            'confirmation_verdict' => ['required', Rule::in(['Confirmed', 'Reopened'])],
            'confirmation_notes'   => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($ticket, $subIssue, $data, $request) {
            $confirmed = $data['confirmation_verdict'] === 'Confirmed';
            $vehicleName = $ticket->vehicle->vehicle_name;

            if ($confirmed) {
                $subIssue->update([
                    'status'               => 'Done',
                    'confirmation_verdict' => 'Confirmed',
                    'confirmation_notes'   => $data['confirmation_notes'] ?? null,
                    'confirmed_by'         => $request->user()->id,
                    'confirmed_at'         => now(),
                ]);

                if ($subIssue->issue_report_id) {
                    VehicleIssueReport::where('issue_report_id', $subIssue->issue_report_id)->update(['status' => 'Resolved']);
                }

                // Unify ledger: every confirmed sub-issue is a line in the
                // single complete maintenance history, same as before.
                if ($subIssue->assigned_mechanic_id) {
                    VehicleMaintenanceRecord::create([
                        'vehicle_id'               => $ticket->vehicle_id,
                        'issue_report_id'          => $subIssue->issue_report_id,
                        'maintenance_type'         => $subIssue->maintenance_type ?? 'Repair',
                        'problem_reason'           => $ticket->ticket_title . ': ' . $subIssue->title,
                        'date_started'             => $subIssue->repair_started_at,
                        'date_completed'           => $subIssue->repair_completed_at ?? now()->toDateString(),
                        'maintenance_personnel_id' => $subIssue->assigned_mechanic_id,
                        'action_taken'             => $subIssue->repair_logs ?? 'No logs provided.',
                        'parts_used'               => $subIssue->parts_used,
                        'maintenance_cost'         => $subIssue->maintenance_cost,
                        'progress_status'          => 'Completed',
                        'remarks'                  => $subIssue->confirmation_notes ?? "Confirmed through Ticket #{$ticket->ticket_id}",
                        'verification_result'      => 'Passed',
                        'verification_notes'       => $subIssue->verification_notes,
                        'verified_by'              => $subIssue->verified_by,
                        'verified_at'              => $subIssue->verified_at,
                        'confirmed_by'             => $subIssue->confirmed_by,
                        'confirmed_at'             => $subIssue->confirmed_at,
                    ]);
                }

                $progress = $ticket->fresh()->progress;
                $this->log($request, 'Sub-Issue Confirmed', "Ticket #{$ticket->ticket_id} — sub-issue \"{$subIssue->title}\" confirmed Done. Progress {$progress['done']}/{$progress['total']}.");

                $this->notifyUser(
                    $ticket->assigned_custodian_id,
                    'Sub-Issue Confirmed',
                    "\"{$subIssue->title}\" on Ticket #{$ticket->ticket_id} ({$vehicleName}) has been confirmed Done ({$progress['done']}/{$progress['total']}).",
                    'sub_issue_confirmed',
                    $ticket->ticket_id
                );

                if ($progress['done'] === $progress['total']) {
                    $this->notifyAdmins(
                        'Ticket Ready to Close',
                        "All sub-issues on Ticket #{$ticket->ticket_id} ({$vehicleName}) are Done ({$progress['done']}/{$progress['total']}). You may now close the ticket.",
                        'ticket_ready_to_close',
                        $ticket->ticket_id
                    );
                }
            } else {
                // Rework loop — the sub-issue isn't actually done yet, so
                // this is not the "reopen a Closed ticket" case at all.
                $subIssue->update([
                    'status'               => 'Under Repair',
                    'confirmation_verdict' => 'Reopened',
                    'confirmation_notes'   => $data['confirmation_notes'] ?? null,
                    'confirmed_by'         => $request->user()->id,
                    'confirmed_at'         => now(),
                    'verification_verdict' => null,
                    'verification_notes'   => null,
                    'verified_by'          => null,
                    'verified_at'          => null,
                    'repair_completed_at'  => null,
                ]);

                $this->log($request, 'Sub-Issue Sent Back', "Ticket #{$ticket->ticket_id} — sub-issue \"{$subIssue->title}\" sent back to Under Repair by Admin.");

                $this->notifyUser(
                    $subIssue->assigned_mechanic_id,
                    'Work Order Sent Back',
                    "\"{$subIssue->title}\" on Ticket #{$ticket->ticket_id} ({$vehicleName}) was sent back by Admin. Please re-perform repairs.",
                    'work_order_reopened',
                    $ticket->ticket_id
                );
            }
        });

        return $subIssue->fresh();
    }

    // ===================================================================
    // PHASE 5 — Admin: Explicit Ticket Closure (only at N/N)
    // ===================================================================

    public function closeTicket(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless($ticket->status === 'Active', 422, "Only an Active ticket can be closed. Current: {$ticket->status}.");

        $ticket->load('subIssues');
        abort_unless($ticket->isEligibleToClose(), 422, 'Every sub-issue must be Done before this ticket can be closed.');

        $data = $request->validate([
            'closing_notes' => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($ticket, $data, $request) {
            $vehicleName = $ticket->vehicle->vehicle_name;

            $ticket->update([
                'status'        => 'Closed',
                'closed_by'     => $request->user()->id,
                'closed_at'     => now(),
                'closing_notes' => $data['closing_notes'] ?? null,
                'archived_at'   => now(),
            ]);

            if ($ticket->issue_report_id) {
                VehicleIssueReport::where('issue_report_id', $ticket->issue_report_id)->update(['status' => 'Resolved']);
            }

            $this->archiveCompleted($ticket->fresh()->load('subIssues'), $request->user()->id, 'Closed');

            // Single choke point: only closing a ticket may free the
            // vehicle, and only after checking every OTHER ticket on it.
            $this->recomputeVehicleStatus($ticket->vehicle_id);

            $this->log($request, 'Ticket Closed', "Ticket #{$ticket->ticket_id} ({$vehicleName}) closed by Admin. Progress: {$ticket->progress['done']}/{$ticket->progress['total']}.");

            $this->notifyUser(
                $ticket->assigned_custodian_id,
                'Ticket Closed',
                "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been closed by Admin.",
                'ticket_closed',
                $ticket->ticket_id
            );
            foreach ($ticket->subIssues->pluck('assigned_mechanic_id')->filter()->unique() as $mechanicId) {
                $this->notifyUser($mechanicId, 'Ticket Closed', "Ticket #{$ticket->ticket_id} ({$vehicleName}) has been closed by Admin.", 'ticket_closed', $ticket->ticket_id);
            }
        });

        return $ticket->fresh($this->eagerLoads());
    }

    /**
     * PUT /tickets/:ticket/cancel — Admin cancels a ticket at any stage
     * before it's Closed.
     */
    public function cancelTicket(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless(!in_array($ticket->status, ['Closed', 'Cancelled'], true), 422, 'This ticket is already closed and cannot be cancelled.');

        $data = $request->validate([
            'closing_notes' => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($ticket, $data, $request) {
            $ticket->update([
                'status'        => 'Cancelled',
                'closing_notes' => $data['closing_notes'] ?? null,
            ]);

            $this->resetLinkedIssueReports($ticket, 'Pending');
            $this->recomputeVehicleStatus($ticket->vehicle_id);

            $this->log($request, 'Ticket Cancelled', "Ticket #{$ticket->ticket_id} was cancelled by admin.");
        });

        return $ticket->fresh($this->eagerLoads());
    }

    /**
     * PUT /tickets/:ticket/uncancel — Admin restores a cancelled ticket.
     * Cancelling is not the same as Closing, so this remains available —
     * it only ever targets a ticket that was never actually completed.
     */
    public function uncancelTicket(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless($ticket->status === 'Cancelled', 422, 'Only cancelled tickets can be restored.');

        $restoredStatus = $ticket->inspected_at ? 'Active' : 'Open';

        DB::transaction(function () use ($ticket, $restoredStatus, $request) {
            $ticket->update([
                'status'        => $restoredStatus,
                'closing_notes' => null,
            ]);

            $this->resetLinkedIssueReports($ticket, 'In Maintenance');
            $this->recomputeVehicleStatus($ticket->vehicle_id);

            $this->log($request, 'Ticket Restored', "Ticket #{$ticket->ticket_id} was restored back to '{$restoredStatus}' by Admin.");
        });

        return $ticket->fresh($this->eagerLoads());
    }

    /**
     * DELETE /tickets/:ticket — Admin deletes a ticket completely.
     *
     * A ticket that never had any real progress (no sub-issue ever reached
     * Done) is just discarded, same as always. But a ticket that already
     * had at least one sub-issue confirmed Done represents real completed
     * work — deleting that is exactly the "accidental click on unfinished
     * work" case reopening exists for, so it's archived as "Deleted" and
     * recoverable via Reopen (same safety net Cancel/Uncancel already has).
     * A ticket the Admin has explicitly Closed is a separate, permanent
     * action — see closeTicket() — and is never reachable from here.
     */
    public function deleteTicket(Request $request, MaintenanceTicket $ticket)
    {
        $this->requireRole($request, ['Admin']);

        DB::transaction(function () use ($ticket, $request) {
            $vehicleId = $ticket->vehicle_id;
            $ticket->load('subIssues');
            $hadProgress = $ticket->subIssues->contains(fn (TicketSubIssue $s) => $s->status === 'Done');

            $this->resetLinkedIssueReports($ticket, 'Pending');

            if ($hadProgress) {
                $this->archiveCompleted($ticket, $request->user()->id, 'Deleted');
            }

            $ticket->delete(); // cascades to ticket_sub_issues

            $this->recomputeVehicleStatus($vehicleId);

            $this->log($request, 'Delete Ticket', "Ticket #{$ticket->ticket_id} was deleted by Admin." . ($hadProgress ? ' Archived as recoverable — it had at least one completed sub-issue.' : ''));
        });

        return response()->json(['message' => 'Ticket deleted successfully.'], 200);
    }

    /**
     * PUT /ticket-archives/:archive/reopen — Admin recovers an accidentally
     * deleted ticket that had real progress on it. Only ever available for
     * archive entries tagged "Deleted" — a "Closed" entry is permanently
     * locked and this will refuse it.
     */
    public function reopenArchive(Request $request, TicketArchiveLog $archive)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless($archive->final_status === 'Deleted', 422, 'Only a deleted, not-yet-finished ticket can be reopened — a Closed ticket is permanently locked.');

        $snapshot = $archive->full_ticket_snapshot;

        $duplicateMainIssue = MaintenanceTicket::where('vehicle_id', $archive->vehicle_id)
            ->whereRaw('LOWER(TRIM(ticket_title)) = ?', [mb_strtolower(trim($snapshot['ticket_title']))])
            ->whereNotIn('status', ['Closed', 'Cancelled'])
            ->exists();

        abort_if($duplicateMainIssue, 422, 'This vehicle already has an open ticket for this Main Issue — cannot reopen a duplicate.');

        $ticket = DB::transaction(function () use ($snapshot, $archive, $request) {
            $ticket = MaintenanceTicket::create([
                'vehicle_id'            => $snapshot['vehicle_id'],
                'issue_report_id'       => $snapshot['issue_report_id'] ?? null,
                'created_by'            => $snapshot['created_by'],
                'ticket_title'          => $snapshot['ticket_title'],
                'ticket_description'    => $snapshot['ticket_description'],
                'priority'              => $snapshot['priority'],
                'status'                => $snapshot['status'],
                'assigned_custodian_id' => $snapshot['assigned_custodian_id'] ?? null,
                'assigned_at'           => $snapshot['assigned_at'] ?? null,
                'inspection_notes'      => $snapshot['inspection_notes'] ?? null,
                'inspection_result'     => $snapshot['inspection_result'] ?? null,
                'inspected_by'          => $snapshot['inspected_by'] ?? null,
                'inspected_at'          => $snapshot['inspected_at'] ?? null,
            ]);

            $subIssueFields = [
                'issue_report_id', 'created_by', 'title', 'status', 'assigned_mechanic_id',
                'maintenance_type', 'work_order_notes', 'mechanic_assigned_at', 'mechanic_assigned_by',
                'repair_logs', 'parts_used', 'repair_started_at', 'repair_completed_at', 'maintenance_cost',
                'verification_verdict', 'verification_notes', 'verified_by', 'verified_at',
                'confirmation_verdict', 'confirmation_notes', 'confirmed_by', 'confirmed_at',
            ];

            foreach ($snapshot['sub_issues'] ?? [] as $si) {
                TicketSubIssue::create([
                    'ticket_id' => $ticket->ticket_id,
                    ...array_intersect_key($si, array_flip($subIssueFields)),
                ]);

                if (!empty($si['issue_report_id'])) {
                    VehicleIssueReport::where('issue_report_id', $si['issue_report_id'])->update(['status' => 'In Maintenance']);
                }
            }

            if ($ticket->issue_report_id) {
                VehicleIssueReport::where('issue_report_id', $ticket->issue_report_id)->update(['status' => 'In Maintenance']);
            }

            $this->recomputeVehicleStatus($ticket->vehicle_id);

            $archive->delete();

            $this->log($request, 'Ticket Reopened', "Deleted Ticket #{$snapshot['ticket_id']} was reopened by Admin as new Ticket #{$ticket->ticket_id}.");

            $this->notifyUser($ticket->assigned_custodian_id, 'Ticket Reopened', "A deleted ticket for {$archive->vehicle_name} was reopened by Admin as Ticket #{$ticket->ticket_id}.", 'ticket_reopened', $ticket->ticket_id);

            return $ticket;
        });

        return response()->json($ticket->load($this->eagerLoads()), 201);
    }

    // ===================================================================
    // Internal helpers
    // ===================================================================

    /**
     * Every closed/cancelled ticket check runs through here: a vehicle
     * only returns to Available once NONE of its tickets are still open.
     * This is the single choke point — no other action may flip the
     * vehicle's status, which is what prevents an emergency vehicle from
     * being marked ready while a second, unrelated ticket is still open.
     */
    private function recomputeVehicleStatus(int $vehicleId): void
    {
        $stillOpen = MaintenanceTicket::where('vehicle_id', $vehicleId)
            ->whereNotIn('status', ['Closed', 'Cancelled'])
            ->exists();

        if ($stillOpen) {
            Vehicle::where('vehicle_id', $vehicleId)->update(['status' => 'Under Maintenance']);
        } else {
            Vehicle::where('vehicle_id', $vehicleId)->update([
                'status'                => 'Available',
                'condition'             => 'Good',
                'estimated_return_date' => null,
            ]);
        }
    }

    private function resetLinkedIssueReports(MaintenanceTicket $ticket, string $status): void
    {
        $ids = $ticket->subIssues()->pluck('issue_report_id')
            ->push($ticket->issue_report_id)
            ->filter()
            ->unique();

        if ($ids->isNotEmpty()) {
            VehicleIssueReport::whereIn('issue_report_id', $ids)->update(['status' => $status]);
        }
    }

    private function assertBelongsToTicket(MaintenanceTicket $ticket, TicketSubIssue $subIssue): void
    {
        abort_unless($subIssue->ticket_id === $ticket->ticket_id, 404, 'That sub-issue does not belong to this ticket.');
    }

    private function archiveCompleted(MaintenanceTicket $ticket, int $userId, ?string $finalStatus = null): void
    {
        $vehicle = $ticket->vehicle;

        TicketArchiveLog::create([
            'ticket_id'            => $ticket->ticket_id,
            'vehicle_id'           => $ticket->vehicle_id,
            'ticket_title'         => $ticket->ticket_title,
            'vehicle_name'         => $vehicle->vehicle_name,
            'plate_number'         => $vehicle->plate_number,
            'final_status'         => $finalStatus ?? $ticket->status,
            'maintenance_cost'     => $ticket->subIssues->sum('maintenance_cost'),
            'full_ticket_snapshot' => $ticket->toArray(),
            'archived_by'          => $userId,
            'archived_at'          => now(),
        ]);
    }

    private function eagerLoads(): array
    {
        return [
            'vehicle',
            'issueReport',
            'createdBy',
            'assignedCustodian',
            'inspectedBy',
            'closedBy',
            'subIssues.assignedMechanic',
            'subIssues.mechanicAssignedBy',
            'subIssues.verifiedBy',
            'subIssues.confirmedBy',
            'subIssues.createdBy',
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
        $admins = User::where('role', 'Admin')->get();
        foreach ($admins as $admin) {
            $this->notifyUser($admin->id, $title, $message, $type, $ticketId);
        }
    }
}
