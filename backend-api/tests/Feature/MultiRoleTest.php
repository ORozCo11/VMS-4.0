<?php

namespace Tests\Feature;

use App\Models\MaintenanceTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleCategory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * MULTI-ROLE ACCOUNTS
 *
 * A role is a hat, not a headcount. One person in a small barangay can hold
 * several roles on a single account and act under each — the system enforces
 * separation by ROLE (not by person), so the workflow still completes with
 * one human, and every action records which function they performed.
 */
class MultiRoleTest extends TestCase
{
    use RefreshDatabase;

    private function vehicle(): Vehicle
    {
        $category = VehicleCategory::create(['category_name' => 'Ambulance ' . uniqid(), 'description' => 'x']);

        return Vehicle::create([
            'vehicle_name' => 'Barangay Ambulance',
            'plate_number' => 'TST ' . random_int(1000, 9999),
            'category_id' => $category->category_id,
            'brand' => 'Toyota', 'model' => 'HiAce', 'year_model' => 2022,
            'capacity' => '12 pax', 'vehicle_color' => 'White', 'current_location' => 'Main Depot',
        ]);
    }

    #[Test]
    public function has_role_falls_back_to_primary_role_when_roles_list_is_empty(): void
    {
        $user = User::factory()->create(['role' => 'Admin', 'roles' => null]);

        $this->assertTrue($user->hasRole('Admin'));
        $this->assertFalse($user->hasRole('Custodian'));
    }

    #[Test]
    public function a_multi_hat_user_is_offered_as_both_a_custodian_and_a_mechanic(): void
    {
        $admin = User::factory()->create(['role' => 'Admin', 'roles' => ['Admin']]);
        $juan = User::factory()->create(['role' => 'Custodian', 'roles' => ['Custodian', 'Maintenance Personnel']]);

        Sanctum::actingAs($admin, ['*']);
        $response = $this->getJson('/api/tickets/lookups')->assertOk();

        $custodianIds = collect($response->json('custodians'))->pluck('id');
        $mechanicIds  = collect($response->json('maintenance_personnel'))->pluck('id');

        $this->assertTrue($custodianIds->contains($juan->id), 'Juan should be assignable as a custodian.');
        $this->assertTrue($mechanicIds->contains($juan->id), 'Juan should also be assignable as a mechanic.');
    }

    #[Test]
    public function one_person_holding_two_hats_can_run_the_whole_pipeline(): void
    {
        $admin = User::factory()->create(['role' => 'Admin', 'roles' => ['Admin']]);
        // Juan is the barangay's single utility staffer — Custodian AND Maintenance.
        $juan = User::factory()->create(['role' => 'Custodian', 'roles' => ['Custodian', 'Maintenance Personnel']]);
        $vehicle = $this->vehicle();

        // Admin creates the ticket and assigns Juan (as Custodian) to inspect.
        Sanctum::actingAs($admin, ['*']);
        $ticketId = $this->postJson('/api/tickets', [
            'vehicle_id' => $vehicle->vehicle_id,
            'ticket_title' => 'Overheating',
            'ticket_description' => 'Runs hot.',
            'priority' => 'High',
            'assigned_custodian_id' => $juan->id,
        ])->assertCreated()->json('ticket_id');

        // Juan (as Custodian) inspects and logs a sub-issue.
        Sanctum::actingAs($juan, ['*']);
        $this->putJson("/api/tickets/{$ticketId}/inspect", [
            'inspection_result' => 'Needs Maintenance',
            'inspection_notes' => 'Confirmed.',
            'sub_issues' => [['title' => 'Low coolant level']],
        ])->assertOk();

        $subIssue = MaintenanceTicket::find($ticketId)->subIssues->first();

        // Admin assigns the repair to Juan (now wearing his Maintenance hat).
        Sanctum::actingAs($admin, ['*']);
        $this->putJson("/api/tickets/{$ticketId}/sub-issues/{$subIssue->sub_issue_id}/assign-mechanic", [
            'assigned_mechanic_id' => $juan->id,
            'maintenance_type' => 'Engine Repair',
        ])->assertOk();

        // Juan (as Maintenance) logs the repair.
        Sanctum::actingAs($juan, ['*']);
        $this->putJson("/api/tickets/{$ticketId}/sub-issues/{$subIssue->sub_issue_id}/log-repairs", [
            'repair_logs' => 'Refilled coolant, tested.',
        ])->assertOk();

        // Juan (back in his Custodian hat) runs the functional test and accepts.
        $this->putJson("/api/tickets/{$ticketId}/sub-issues/{$subIssue->sub_issue_id}/verify", [
            'verification_verdict' => 'Approved',
            'test_attested' => true,
            'functional_test' => [['item' => 'Reported issue no longer occurs', 'passed' => true]],
        ])->assertOk();

        // Admin gives the final verdict and closes.
        Sanctum::actingAs($admin, ['*']);
        $this->putJson("/api/tickets/{$ticketId}/sub-issues/{$subIssue->sub_issue_id}/confirm", [
            'confirmation_verdict' => 'Confirmed',
        ])->assertOk();
        $this->putJson("/api/tickets/{$ticketId}/close", [])->assertOk();

        $this->assertSame('Closed', MaintenanceTicket::find($ticketId)->status);
        $this->assertSame('Available', $vehicle->fresh()->status);
    }
}
