<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\ConcernReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * SuperAdminController is scoped to accounts only (see its class docblock):
 * a Super Admin can never see a barangay's vehicles, tickets, or other
 * fleet data. activityLog() shares the activity_logs table with
 * FleetController/TicketController, which log fine-grained fleet-detail
 * entries for a barangay's own Admin audit trail — those must never surface
 * through the Super Admin endpoint.
 */
class SuperAdminControllerTest extends TestCase
{
    use RefreshDatabase;

    #[Test]
    public function super_admin_activity_log_excludes_fleet_detail_entries(): void
    {
        $superAdmin = User::factory()->create(['role' => 'Super Admin', 'roles' => ['Super Admin']]);

        // A fleet-operational entry, the kind FleetController logs for a
        // barangay Admin's own audit trail — must NOT appear here.
        ActivityLog::create([
            'user_id' => $superAdmin->id,
            'role' => 'Admin',
            'action' => 'Add',
            'module' => 'Vehicle Management',
            'details' => 'Added vehicle Dump Truck 01',
        ]);

        // A ticket-workflow entry, logged by TicketController — also must
        // NOT appear here.
        ActivityLog::create([
            'user_id' => $superAdmin->id,
            'role' => 'Admin',
            'action' => 'Create Ticket',
            'module' => 'Maintenance Tickets',
            'details' => 'Ticket #1 created for Dump Truck 01',
        ]);

        // An account/admin-level entry — this SHOULD appear.
        ActivityLog::create([
            'user_id' => $superAdmin->id,
            'role' => 'Super Admin',
            'action' => 'Activate',
            'module' => 'Super Admin',
            'details' => 'Activated Jane Doe (jane@example.com).',
        ]);

        Sanctum::actingAs($superAdmin, ['*']);
        $response = $this->getJson('/api/superadmin/activity-log')->assertOk();

        $modules = collect($response->json())->pluck('module');

        $this->assertFalse($modules->contains('Vehicle Management'), 'Fleet-detail entries must not leak into the Super Admin activity log.');
        $this->assertFalse($modules->contains('Maintenance Tickets'), 'Ticket-detail entries must not leak into the Super Admin activity log.');
        $this->assertTrue($modules->contains('Super Admin'), 'Account-level entries should still appear in the Super Admin activity log.');
    }

    #[Test]
    public function only_super_admin_can_delete_a_concern_report(): void
    {
        $admin = User::factory()->create(['role' => 'Admin', 'roles' => ['Admin']]);
        $report = ConcernReport::create([
            'concern_type' => 'Other',
            'description' => 'Spam submission',
            'status' => 'Open',
        ]);

        Sanctum::actingAs($admin, ['*']);
        $this->deleteJson("/api/superadmin/concern-reports/{$report->id}")->assertStatus(403);
        $this->assertDatabaseHas('concern_reports', ['id' => $report->id]);
    }

    #[Test]
    public function super_admin_can_delete_a_concern_report_and_it_is_actually_removed(): void
    {
        $superAdmin = User::factory()->create(['role' => 'Super Admin', 'roles' => ['Super Admin']]);
        $report = ConcernReport::create([
            'concern_type' => 'Other',
            'description' => 'Spam submission',
            'status' => 'Open',
        ]);

        Sanctum::actingAs($superAdmin, ['*']);
        $this->deleteJson("/api/superadmin/concern-reports/{$report->id}")->assertOk();

        $this->assertDatabaseMissing('concern_reports', ['id' => $report->id]);
    }
}
