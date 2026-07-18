<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * DEV-ONLY impersonation — the dangerous part is making sure it CANNOT work
 * in production. These tests pin both the happy path and the hard gate.
 */
class ImpersonationTest extends TestCase
{
    use RefreshDatabase;

    #[Test]
    public function a_developer_can_impersonate_another_account_in_the_test_environment(): void
    {
        $admin = User::factory()->create(['role' => 'Admin', 'roles' => ['Admin']]);
        $custodian = User::factory()->create(['role' => 'Custodian', 'roles' => ['Custodian']]);

        Sanctum::actingAs($admin, ['*']);
        $response = $this->postJson("/api/impersonate/{$custodian->id}")->assertOk();

        $this->assertNotEmpty($response->json('access_token'));
        $this->assertSame($custodian->id, $response->json('user.id'));
        $this->assertSame('Custodian', $response->json('user.role'));
    }

    #[Test]
    public function impersonation_does_not_exist_in_production(): void
    {
        // The whole safety of the feature rests on this: outside local/testing
        // the endpoint 404s, so a deployed app has no impersonation surface.
        $this->app['env'] = 'production';

        $admin = User::factory()->create(['role' => 'Admin', 'roles' => ['Admin']]);
        $target = User::factory()->create(['role' => 'Custodian', 'roles' => ['Custodian']]);

        Sanctum::actingAs($admin, ['*']);
        $this->postJson("/api/impersonate/{$target->id}")->assertNotFound();
        $this->getJson('/api/impersonate/candidates')->assertNotFound();
    }

    #[Test]
    public function a_deactivated_account_cannot_be_impersonated(): void
    {
        $admin = User::factory()->create(['role' => 'Admin', 'roles' => ['Admin']]);
        $inactive = User::factory()->create(['role' => 'Custodian', 'roles' => ['Custodian'], 'is_active' => false]);

        Sanctum::actingAs($admin, ['*']);
        $this->postJson("/api/impersonate/{$inactive->id}")->assertStatus(422);
    }

    #[Test]
    public function impersonation_requires_authentication(): void
    {
        $target = User::factory()->create(['role' => 'Custodian', 'roles' => ['Custodian']]);

        $this->postJson("/api/impersonate/{$target->id}")->assertUnauthorized();
    }
}
