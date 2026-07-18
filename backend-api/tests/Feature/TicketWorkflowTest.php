<?php

namespace Tests\Feature;

use App\Models\MaintenanceTicket;
use App\Models\TicketArchiveLog;
use App\Models\TicketSubIssue;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleCategory;
use App\Models\VehicleMaintenanceRecord;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * WORKFLOW GUARD TESTS
 *
 * A ticket is a Main Issue container holding one or more independently
 * tracked Sub-Issues, each running assign -> repair -> verify -> confirm
 * on its own. These tests prove: who may act at each phase, that sub-issues
 * can be appended while a ticket is Active, that closing requires every
 * sub-issue Done, and that a vehicle only returns to service once NONE of
 * its tickets are still open — not just the one that happened to close.
 */
class TicketWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $custodian;
    private User $mechanic;
    private User $mechanic2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->create(['role' => 'Admin']);
        $this->custodian = User::factory()->create(['role' => 'Custodian']);
        $this->mechanic = User::factory()->create(['role' => 'Maintenance Personnel']);
        $this->mechanic2 = User::factory()->create(['role' => 'Maintenance Personnel']);
    }

    private function vehicle(array $overrides = []): Vehicle
    {
        $category = VehicleCategory::create([
            'category_name' => 'Ambulance ' . uniqid(),
            'description' => 'For testing',
        ]);

        return Vehicle::create(array_merge([
            'vehicle_name' => 'Test Ambulance',
            'plate_number' => 'TST ' . random_int(1000, 9999),
            'category_id' => $category->category_id,
            'brand' => 'Toyota',
            'model' => 'HiAce',
            'year_model' => 2022,
            'capacity' => '1000 kg',
            'vehicle_color' => 'White',
            'current_location' => 'Main Depot',
        ], $overrides));
    }

    private function createTicket(Vehicle $vehicle, string $title = 'Overheating'): MaintenanceTicket
    {
        Sanctum::actingAs($this->admin, ['*']);
        $response = $this->postJson('/api/tickets', [
            'vehicle_id' => $vehicle->vehicle_id,
            'ticket_title' => $title,
            'ticket_description' => 'Engine runs hot after 10 minutes.',
            'priority' => 'High',
            'assigned_custodian_id' => $this->custodian->id,
        ]);
        $response->assertCreated();

        return MaintenanceTicket::findOrFail($response->json('ticket_id'));
    }

    /** Inspects and populates the sub-issue list in one call. */
    private function inspectWithSubIssues(MaintenanceTicket $ticket, array $titles): MaintenanceTicket
    {
        Sanctum::actingAs($this->custodian, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/inspect", [
            'inspection_result' => 'Needs Maintenance',
            'inspection_notes' => 'Confirmed on physical check.',
            'sub_issues' => array_map(fn ($t) => ['title' => $t], $titles),
        ])->assertOk();

        return $ticket->fresh();
    }

    private function driveSubIssueToDone(MaintenanceTicket $ticket, TicketSubIssue $subIssue, ?User $mechanic = null): void
    {
        $mechanic ??= $this->mechanic;

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/assign-mechanic", [
            'assigned_mechanic_id' => $mechanic->id,
            'maintenance_type' => 'Engine Repair',
        ])->assertOk();

        Sanctum::actingAs($mechanic, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/log-repairs", [
            'repair_logs' => 'Fixed it.',
        ])->assertOk();

        Sanctum::actingAs($this->custodian, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/verify", [
            'verification_verdict' => 'Approved',
        ])->assertOk();

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/confirm", [
            'confirmation_verdict' => 'Confirmed',
        ])->assertOk();
    }

    #[Test]
    public function a_confirmed_maintenance_need_pulls_the_vehicle_immediately_not_at_mechanic_assignment(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);

        $this->assertSame('Available', $vehicle->fresh()->status);

        $this->inspectWithSubIssues($ticket, ['Low coolant level']);

        // The vehicle must already be pulled from service the moment the
        // Custodian confirms real repair is needed — not later, whenever
        // an Admin happens to get around to assigning a mechanic.
        $this->assertSame('Under Maintenance', $vehicle->fresh()->status);
        $this->assertSame('Needs Repair', $vehicle->fresh()->condition);
    }

    #[Test]
    public function a_no_issues_inspection_clears_a_stale_needs_inspection_flag(): void
    {
        $vehicle = $this->vehicle(['condition' => 'Needs Inspection']);
        $ticket = $this->createTicket($vehicle);

        Sanctum::actingAs($this->custodian, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/inspect", [
            'inspection_result' => 'No Issues',
            'inspection_notes' => 'Checked, nothing wrong.',
        ])->assertOk();

        $this->assertSame('Good', $vehicle->fresh()->condition);
        $this->assertSame('Available', $vehicle->fresh()->status);
    }

    #[Test]
    public function a_mechanic_can_attach_a_photo_or_document_when_logging_repairs(): void
    {
        Storage::fake('supabase');

        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level']);
        $subIssue = $ticket->subIssues->first();

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/assign-mechanic", [
            'assigned_mechanic_id' => $this->mechanic->id,
            'maintenance_type' => 'Engine Repair',
        ])->assertOk();

        Sanctum::actingAs($this->mechanic, ['*']);
        $this->put("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/log-repairs", [
            'repair_logs' => 'Topped up coolant.',
            'photo' => UploadedFile::fake()->create('receipt.pdf', 100, 'application/pdf'),
        ])->assertOk();

        $subIssue->refresh();
        $this->assertNotNull($subIssue->attachment_url);
    }

    #[Test]
    public function only_an_admin_can_create_a_ticket(): void
    {
        $vehicle = $this->vehicle();

        Sanctum::actingAs($this->custodian, ['*']);
        $this->postJson('/api/tickets', [
            'vehicle_id' => $vehicle->vehicle_id,
            'ticket_title' => 'Nope',
            'ticket_description' => 'Custodians cannot open tickets.',
            'priority' => 'Low',
            'assigned_custodian_id' => $this->custodian->id,
        ])->assertForbidden();
    }

    #[Test]
    public function the_same_main_issue_cannot_open_twice_while_one_is_still_active(): void
    {
        $vehicle = $this->vehicle();
        $this->createTicket($vehicle, 'Overheating');

        Sanctum::actingAs($this->admin, ['*']);
        $this->postJson('/api/tickets', [
            'vehicle_id' => $vehicle->vehicle_id,
            'ticket_title' => 'overheating', // case/whitespace-insensitive match
            'ticket_description' => 'Reported again.',
            'priority' => 'Medium',
            'assigned_custodian_id' => $this->custodian->id,
        ])->assertUnprocessable();
    }

    #[Test]
    public function a_different_main_issue_can_open_concurrently_on_the_same_vehicle(): void
    {
        $vehicle = $this->vehicle();
        $this->createTicket($vehicle, 'Overheating');

        Sanctum::actingAs($this->admin, ['*']);
        $this->postJson('/api/tickets', [
            'vehicle_id' => $vehicle->vehicle_id,
            'ticket_title' => 'Flat Tire',
            'ticket_description' => 'Rear right tire is flat.',
            'priority' => 'Medium',
            'assigned_custodian_id' => $this->custodian->id,
        ])->assertCreated();

        $this->assertSame(2, MaintenanceTicket::where('vehicle_id', $vehicle->vehicle_id)->count());
    }

    #[Test]
    public function a_mechanic_cannot_be_assigned_before_a_sub_issue_exists(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level']);
        $subIssue = $ticket->subIssues->first();

        // A random other user cannot skip straight to a state that isn't Open.
        $subIssue->update(['status' => 'For Inspection']);

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/assign-mechanic", [
            'assigned_mechanic_id' => $this->mechanic->id,
            'maintenance_type' => 'Engine Repair',
        ])->assertUnprocessable();
    }

    #[Test]
    public function sub_issues_can_go_to_different_mechanics_and_progress_counts_correctly(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level', 'Faulty radiator']);

        $this->assertSame(['done' => 0, 'total' => 2], $ticket->progress);

        [$coolant, $radiator] = $ticket->subIssues;

        $this->driveSubIssueToDone($ticket, $coolant, $this->mechanic);
        $this->assertSame(['done' => 1, 'total' => 2], $ticket->fresh()->progress);

        $this->driveSubIssueToDone($ticket, $radiator, $this->mechanic2);
        $this->assertSame(['done' => 2, 'total' => 2], $ticket->fresh()->progress);

        $this->assertSame($this->mechanic->id, $coolant->fresh()->assigned_mechanic_id);
        $this->assertSame($this->mechanic2->id, $radiator->fresh()->assigned_mechanic_id);
    }

    #[Test]
    public function a_sub_issue_can_be_appended_while_the_ticket_is_active_and_grows_the_denominator(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level', 'Faulty radiator']);

        Sanctum::actingAs($this->admin, ['*']);
        $this->postJson("/api/tickets/{$ticket->ticket_id}/sub-issues", [
            'title' => 'Broken water pump',
        ])->assertCreated();

        $this->assertSame(['done' => 0, 'total' => 3], $ticket->fresh()->progress);
    }

    #[Test]
    public function a_rejected_verification_sends_the_sub_issue_back_to_repair(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level']);
        $subIssue = $ticket->subIssues->first();

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/assign-mechanic", [
            'assigned_mechanic_id' => $this->mechanic->id,
            'maintenance_type' => 'Engine Repair',
        ])->assertOk();

        Sanctum::actingAs($this->mechanic, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/log-repairs", [
            'repair_logs' => 'Topped up coolant.',
        ])->assertOk();

        Sanctum::actingAs($this->custodian, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/verify", [
            'verification_verdict' => 'Rejected',
            'verification_notes' => 'Still overheating.',
        ])->assertOk();

        $this->assertSame('Under Repair', $subIssue->fresh()->status);
    }

    #[Test]
    public function a_ticket_cannot_close_until_every_sub_issue_is_done(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level', 'Faulty radiator']);

        $this->driveSubIssueToDone($ticket, $ticket->subIssues[0]);

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/close", [])->assertUnprocessable();

        $this->driveSubIssueToDone($ticket->fresh(), $ticket->fresh()->subIssues[1]);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/close", [])->assertOk();

        $this->assertSame('Closed', $ticket->fresh()->status);
        $this->assertTrue(TicketArchiveLog::where('ticket_id', $ticket->ticket_id)->exists());
        $this->assertSame(2, VehicleMaintenanceRecord::where('vehicle_id', $vehicle->vehicle_id)->where('progress_status', 'Completed')->count());
    }

    #[Test]
    public function closed_tickets_are_permanently_locked(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level']);
        $this->driveSubIssueToDone($ticket, $ticket->subIssues[0]);

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/close", [])->assertOk();

        // No new sub-issue can ever be appended to a Closed ticket...
        $this->postJson("/api/tickets/{$ticket->ticket_id}/sub-issues", [
            'title' => 'New problem found later',
        ])->assertUnprocessable();

        // ...and it cannot be cancelled/uncancelled either — Closed is final.
        $this->putJson("/api/tickets/{$ticket->ticket_id}/cancel", [])->assertUnprocessable();
    }

    #[Test]
    public function deleting_a_ticket_with_no_finished_sub_issues_leaves_no_archive_trace(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level']);

        Sanctum::actingAs($this->admin, ['*']);
        $this->deleteJson("/api/tickets/{$ticket->ticket_id}")->assertOk();

        $this->assertFalse(MaintenanceTicket::where('ticket_id', $ticket->ticket_id)->exists());
        $this->assertFalse(TicketArchiveLog::where('ticket_id', $ticket->ticket_id)->exists());
    }

    #[Test]
    public function deleting_a_ticket_with_real_progress_is_archived_and_reopenable(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level', 'Faulty radiator']);

        // One sub-issue reaches Done, the other is still mid-flight.
        $this->driveSubIssueToDone($ticket, $ticket->subIssues[0]);

        Sanctum::actingAs($this->admin, ['*']);
        $this->deleteJson("/api/tickets/{$ticket->ticket_id}")->assertOk();

        $this->assertFalse(MaintenanceTicket::where('ticket_id', $ticket->ticket_id)->exists());
        $archive = TicketArchiveLog::where('ticket_id', $ticket->ticket_id)->first();
        $this->assertNotNull($archive);
        $this->assertSame('Deleted', $archive->final_status);

        // AMB-101-style vehicle should be freed since nothing else is open on it.
        $this->assertSame('Available', $vehicle->fresh()->status);

        $this->putJson("/api/ticket-archives/{$archive->archive_id}/reopen", [])->assertCreated();

        $reopened = MaintenanceTicket::where('ticket_title', $ticket->ticket_title)
            ->where('vehicle_id', $vehicle->vehicle_id)
            ->first();
        $this->assertNotNull($reopened);
        $this->assertSame(2, $reopened->subIssues()->count());
        $this->assertSame(1, $reopened->subIssues()->where('status', 'Done')->count());
        $this->assertFalse(TicketArchiveLog::where('archive_id', $archive->archive_id)->exists());
        $this->assertSame('Under Maintenance', $vehicle->fresh()->status);
    }

    #[Test]
    public function a_closed_archive_entry_can_never_be_reopened(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level']);
        $this->driveSubIssueToDone($ticket, $ticket->subIssues[0]);

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/close", [])->assertOk();
        $archive = TicketArchiveLog::where('ticket_id', $ticket->ticket_id)->firstOrFail();

        $this->putJson("/api/ticket-archives/{$archive->archive_id}/reopen", [])->assertUnprocessable();
    }

    #[Test]
    public function the_vehicle_only_returns_to_service_once_every_open_ticket_is_closed(): void
    {
        $vehicle = $this->vehicle();

        $overheating = $this->createTicket($vehicle, 'Overheating');
        $overheating = $this->inspectWithSubIssues($overheating, ['Low coolant level']);

        Sanctum::actingAs($this->admin, ['*']);
        $flatTire = MaintenanceTicket::findOrFail(
            $this->postJson('/api/tickets', [
                'vehicle_id' => $vehicle->vehicle_id,
                'ticket_title' => 'Flat Tire',
                'ticket_description' => 'Rear right tire is flat.',
                'priority' => 'Medium',
                'assigned_custodian_id' => $this->custodian->id,
            ])->assertCreated()->json('ticket_id')
        );
        $flatTire = $this->inspectWithSubIssues($flatTire, ['Replace rear right tire']);

        // Close the Flat Tire ticket first — Overheating is still open.
        $this->driveSubIssueToDone($flatTire, $flatTire->subIssues[0]);
        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$flatTire->ticket_id}/close", [])->assertOk();

        $this->assertSame('Under Maintenance', $vehicle->fresh()->status, 'Overheating ticket is still open — vehicle must not be marked Available yet.');

        // Now close Overheating too — only now should the vehicle free up.
        $this->driveSubIssueToDone($overheating->fresh(), $overheating->fresh()->subIssues[0]);
        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$overheating->ticket_id}/close", [])->assertOk();

        $this->assertSame('Available', $vehicle->fresh()->status);
        $this->assertSame('Good', $vehicle->fresh()->condition);
    }

    #[Test]
    public function dashboard_badge_counts_reflect_sub_issue_assignment_and_verification(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);
        $ticket = $this->inspectWithSubIssues($ticket, ['Low coolant level']);
        $subIssue = $ticket->subIssues->first();

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/assign-mechanic", [
            'assigned_mechanic_id' => $this->mechanic->id,
            'maintenance_type' => 'Engine Repair',
        ])->assertOk();

        Sanctum::actingAs($this->mechanic, ['*']);
        $this->getJson('/api/dashboard')->assertOk()->assertJsonPath('badge_counts.ticketWorkOrders', 1);

        $this->putJson("/api/tickets/{$ticket->ticket_id}/sub-issues/{$subIssue->sub_issue_id}/log-repairs", [
            'repair_logs' => 'Topped up coolant.',
        ])->assertOk();

        Sanctum::actingAs($this->custodian, ['*']);
        $this->getJson('/api/dashboard')->assertOk()->assertJsonPath('badge_counts.ticketVerifications', 1);
    }

    #[Test]
    public function a_mechanic_cannot_close_their_own_maintenance_record(): void
    {
        $vehicle = $this->vehicle();

        Sanctum::actingAs($this->mechanic, ['*']);
        $create = $this->postJson('/api/maintenance-records', [
            'vehicle_id' => $vehicle->vehicle_id,
            'maintenance_type' => 'Oil Change',
            'problem_reason' => 'Routine oil change',
            'progress_status' => 'Under Repair',
        ]);
        $create->assertCreated();
        $recordId = $create->json('maintenance_id');

        $this->putJson("/api/maintenance-records/{$recordId}", [
            'progress_status' => 'Completed',
        ])->assertOk();

        $this->assertSame(
            'For Verification',
            VehicleMaintenanceRecord::findOrFail($recordId)->progress_status
        );
    }

    #[Test]
    public function a_vehicle_cannot_be_double_booked_for_the_same_date(): void
    {
        $vehicle = $this->vehicle();

        Sanctum::actingAs($this->admin, ['*']);
        $this->postJson('/api/maintenance-schedules', [
            'vehicle_id' => $vehicle->vehicle_id,
            'maintenance_type' => 'Oil Change',
            'scheduled_date' => '2026-08-01',
        ])->assertCreated();

        $this->postJson('/api/maintenance-schedules', [
            'vehicle_id' => $vehicle->vehicle_id,
            'maintenance_type' => 'Tire Rotation',
            'scheduled_date' => '2026-08-01',
        ])->assertUnprocessable();
    }
}
