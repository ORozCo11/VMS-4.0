<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleCategory;
use App\Models\VehicleMaintenanceRecord;
use App\Models\VehicleMaintenanceSchedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Gap 2 — recurring preventive maintenance + closing the loop between a
 * schedule and the record that proves it was done.
 */
class ScheduleCompletionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $mechanic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->create(['role' => 'Admin', 'roles' => ['Admin']]);
        $this->mechanic = User::factory()->create(['role' => 'Maintenance Personnel', 'roles' => ['Maintenance Personnel']]);
    }

    private function vehicle(): Vehicle
    {
        $category = VehicleCategory::create(['category_name' => 'Ambulance ' . uniqid(), 'description' => 'x']);
        return Vehicle::create([
            'vehicle_name' => 'Test Ambulance',
            'plate_number' => 'TST ' . random_int(1000, 9999),
            'category_id' => $category->category_id,
            'brand' => 'Toyota', 'model' => 'HiAce', 'year_model' => 2022,
            'capacity' => '12 pax', 'vehicle_color' => 'White', 'current_location' => 'Main Depot',
        ]);
    }

    private function schedule(Vehicle $vehicle, array $overrides = []): VehicleMaintenanceSchedule
    {
        return VehicleMaintenanceSchedule::create(array_merge([
            'vehicle_id' => $vehicle->vehicle_id,
            'maintenance_type' => 'Oil Change',
            'scheduled_date' => now()->toDateString(),
            'status' => 'Scheduled',
            'created_by' => $this->admin->id,
        ], $overrides));
    }

    #[Test]
    public function completing_a_schedule_marks_it_done_and_creates_a_linked_record(): void
    {
        $vehicle = $this->vehicle();
        $schedule = $this->schedule($vehicle); // one-off (no recurrence)

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/maintenance-schedules/{$schedule->schedule_id}/complete", [
            'maintenance_personnel_id' => $this->mechanic->id,
            'maintenance_cost' => 800,
        ])->assertOk();

        // Schedule closed...
        $this->assertSame('Completed', $schedule->fresh()->status);
        // ...and a matching maintenance record now exists (proof of work).
        $this->assertDatabaseHas('vehicle_maintenance_records', [
            'vehicle_id' => $vehicle->vehicle_id,
            'maintenance_type' => 'Oil Change',
            'progress_status' => 'Completed',
        ]);
        // A one-off schedule does NOT spawn a follow-up.
        $this->assertSame(1, VehicleMaintenanceSchedule::where('vehicle_id', $vehicle->vehicle_id)->count());
    }

    #[Test]
    public function completing_a_recurring_schedule_auto_creates_the_next_one(): void
    {
        $vehicle = $this->vehicle();
        $schedule = $this->schedule($vehicle, [
            'scheduled_date' => '2026-07-20',
            'recurrence_months' => 3,
        ]);

        Sanctum::actingAs($this->admin, ['*']);
        $response = $this->putJson("/api/maintenance-schedules/{$schedule->schedule_id}/complete", [
            'date_completed' => '2026-07-20',
            'maintenance_personnel_id' => $this->mechanic->id,
        ])->assertOk();

        // The next occurrence is seeded 3 months out, still recurring.
        $next = $response->json('next');
        $this->assertNotNull($next, 'A recurring schedule should seed the next occurrence.');
        $this->assertSame('2026-10-20', substr($next['scheduled_date'], 0, 10));
        $this->assertSame(3, $next['recurrence_months']);
        $this->assertSame('Scheduled', $next['status']);

        // Two schedules now exist: the completed one + the next.
        $this->assertSame(2, VehicleMaintenanceSchedule::where('vehicle_id', $vehicle->vehicle_id)->count());
    }

    #[Test]
    public function an_already_completed_schedule_cannot_be_completed_again(): void
    {
        $vehicle = $this->vehicle();
        $schedule = $this->schedule($vehicle, ['status' => 'Completed']);

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/maintenance-schedules/{$schedule->schedule_id}/complete", [])
            ->assertUnprocessable();
    }

    #[Test]
    public function a_custodian_cannot_complete_a_schedule(): void
    {
        $vehicle = $this->vehicle();
        $schedule = $this->schedule($vehicle);
        $custodian = User::factory()->create(['role' => 'Custodian', 'roles' => ['Custodian']]);

        Sanctum::actingAs($custodian, ['*']);
        $this->putJson("/api/maintenance-schedules/{$schedule->schedule_id}/complete", [])
            ->assertForbidden();
    }

    #[Test]
    public function a_new_schedule_always_starts_scheduled_even_if_a_different_status_is_submitted(): void
    {
        $vehicle = $this->vehicle();

        Sanctum::actingAs($this->admin, ['*']);
        $response = $this->postJson('/api/maintenance-schedules', [
            'vehicle_id' => $vehicle->vehicle_id,
            'maintenance_type' => 'Oil Change',
            'scheduled_date' => now()->addDay()->toDateString(),
            'status' => 'Completed', // must be silently ignored — not a valid create input
        ])->assertCreated();

        $this->assertSame('Scheduled', $response->json('status'));
    }

    #[Test]
    public function marking_a_schedule_completed_through_the_raw_update_endpoint_is_rejected(): void
    {
        // Completing must go through completeSchedule() (creates the proof-of-
        // work record and, if recurring, the next occurrence). The plain edit
        // form must not be able to silently skip both.
        $vehicle = $this->vehicle();
        $schedule = $this->schedule($vehicle);

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/maintenance-schedules/{$schedule->schedule_id}", [
            'status' => 'Completed',
        ])->assertUnprocessable();

        $this->assertSame('Scheduled', $schedule->fresh()->status);
    }

    #[Test]
    public function a_schedule_can_still_be_cancelled_through_the_update_endpoint(): void
    {
        $vehicle = $this->vehicle();
        $schedule = $this->schedule($vehicle);

        Sanctum::actingAs($this->admin, ['*']);
        $this->putJson("/api/maintenance-schedules/{$schedule->schedule_id}", [
            'status' => 'Cancelled',
        ])->assertOk();

        $this->assertSame('Cancelled', $schedule->fresh()->status);
    }
}
