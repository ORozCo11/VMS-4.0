<?php

namespace Tests\Feature;

use App\Models\MaintenanceTicket;
use App\Models\TicketArchiveLog;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleCategory;
use App\Models\VehicleMaintenanceRecord;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * WORKFLOW GUARD TESTS
 *
 * These prove the 5-phase maintenance ticket workflow enforces its rules:
 * who may act at each phase, in what order the phases run, and that a
 * finished ticket really returns the vehicle to service. They drive the
 * real HTTP endpoints end-to-end (route -> controller -> database).
 */
class TicketWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $custodian;
    private User $mechanic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->create(['role' => 'Admin']);
        $this->custodian = User::factory()->create(['role' => 'Custodian']);
        $this->mechanic = User::factory()->create(['role' => 'Maintenance Personnel']);
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

    private function createTicket(Vehicle $vehicle): MaintenanceTicket
    {
        Sanctum::actingAs($this->admin, ['*']);
        $response = $this->postJson('/api/tickets', [
            'vehicle_id' => $vehicle->vehicle_id,
            'ticket_title' => 'Brakes feel weak',
            'ticket_description' => 'Grinding noise when braking.',
            'priority' => 'High',
            'assigned_custodian_id' => $this->custodian->id,
        ]);
        $response->assertCreated();

        return MaintenanceTicket::findOrFail($response->json('ticket_id'));
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
    public function a_vehicle_cannot_have_two_active_tickets(): void
    {
        $vehicle = $this->vehicle();
        $this->createTicket($vehicle);

        Sanctum::actingAs($this->admin, ['*']);
        $this->postJson('/api/tickets', [
            'vehicle_id' => $vehicle->vehicle_id,
            'ticket_title' => 'Second defect',
            'ticket_description' => 'Aircon blows warm air.',
            'priority' => 'Medium',
            'assigned_custodian_id' => $this->custodian->id,
        ])->assertUnprocessable();
    }

    #[Test]
    public function a_mechanic_cannot_be_assigned_before_the_custodian_inspects(): void
    {
        $ticket = $this->createTicket($this->vehicle());

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/assign-mechanic", [
            'assigned_mechanic_id' => $this->mechanic->id,
            'maintenance_type' => 'Brake Repair',
        ])->assertUnprocessable();
    }

    #[Test]
    public function the_full_workflow_returns_the_vehicle_to_service(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);

        // Phase 2 — Custodian inspects: needs maintenance
        Sanctum::actingAs($this->custodian, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/inspect", [
            'inspection_result' => 'Needs Maintenance',
            'inspection_notes' => 'Confirmed grinding.',
        ])->assertOk();

        // Phase 3 — Admin dispatches the work order
        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/assign-mechanic", [
            'assigned_mechanic_id' => $this->mechanic->id,
            'maintenance_type' => 'Brake Repair',
        ])->assertOk();
        $this->assertSame('Under Maintenance', $vehicle->fresh()->status);

        // Phase 3 — Mechanic logs the repair
        Sanctum::actingAs($this->mechanic, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/log-repairs", [
            'repair_logs' => 'Replaced brake pads.',
            'parts_used' => 'Brake pads',
            'maintenance_cost' => 1500,
        ])->assertOk();

        // Phase 4T1 — Custodian verifies
        Sanctum::actingAs($this->custodian, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/verify", [
            'verification_verdict' => 'Approved',
        ])->assertOk();

        // Phase 4T2 — Admin confirms; Phase 5 archives
        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/confirm", [
            'confirmation_verdict' => 'Confirmed',
        ])->assertOk();

        $this->assertSame('Done', $ticket->fresh()->status);
        $this->assertSame('Available', $vehicle->fresh()->status);
        $this->assertSame('Good', $vehicle->fresh()->condition);
        $this->assertTrue(TicketArchiveLog::where('ticket_id', $ticket->ticket_id)->exists());
        // The confirmed repair is copied into the unified maintenance ledger.
        $this->assertTrue(
            VehicleMaintenanceRecord::where('vehicle_id', $vehicle->vehicle_id)
                ->where('progress_status', 'Completed')
                ->exists()
        );
    }

    #[Test]
    public function a_rejected_verification_sends_the_ticket_back_to_repair(): void
    {
        $vehicle = $this->vehicle();
        $ticket = $this->createTicket($vehicle);

        Sanctum::actingAs($this->custodian, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/inspect", [
            'inspection_result' => 'Needs Maintenance',
        ])->assertOk();

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/assign-mechanic", [
            'assigned_mechanic_id' => $this->mechanic->id,
            'maintenance_type' => 'Brake Repair',
        ])->assertOk();

        Sanctum::actingAs($this->mechanic, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/log-repairs", [
            'repair_logs' => 'Adjusted pads.',
        ])->assertOk();

        // Custodian rejects — feedback loop to Phase 3
        Sanctum::actingAs($this->custodian, ['*']);
        $this->putJson("/api/tickets/{$ticket->ticket_id}/verify", [
            'verification_verdict' => 'Rejected',
            'verification_notes' => 'Still grinding.',
        ])->assertOk();

        $this->assertSame('Under Repair', $ticket->fresh()->status);
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

        // Marking it "Completed" must demote to "For Verification"
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
