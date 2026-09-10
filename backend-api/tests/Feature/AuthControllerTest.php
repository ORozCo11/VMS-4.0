<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\City;
use App\Models\Province;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class AuthControllerTest extends TestCase
{
    use RefreshDatabase;

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();
        $province = Province::create(['code' => 'TST', 'name' => 'Test Province']);
        $this->city = City::create(['province_id' => $province->id, 'code' => 'TSTC', 'name' => 'Test City']);
    }

    #[Test]
    public function a_failed_registration_for_a_brand_new_barangay_leaves_no_orphaned_barangay_row(): void
    {
        $before = Barangay::count();

        $this->postJson('/api/register', [
            'name' => 'Test Person',
            'email' => 'test-person@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'phone' => '09171234567',
            'address' => '123 Test St',
            'city_id' => $this->city->id,
            'barangay_name' => 'Brand New Barangay',
            // No staff_code — this barangay has never been seeded/configured
            // with one, so this registration must fail...
        ])->assertUnprocessable();

        // ...and must not leave a Barangay row behind for a registration
        // that never actually completed.
        $this->assertSame($before, Barangay::count());
        $this->assertFalse(Barangay::where('name', 'Brand New Barangay')->exists());
    }

    #[Test]
    public function a_pending_never_approved_account_gets_a_distinct_login_message(): void
    {
        $user = User::factory()->create([
            'role' => 'Custodian',
            'roles' => ['Custodian'],
            'is_active' => false,
            'approved_at' => null,
            'password' => bcrypt('password123'),
        ]);

        $response = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ])->assertForbidden();

        $response->assertJsonFragment(['message' => 'Your account is still awaiting approval from your barangay\'s Admin.']);
    }

    #[Test]
    public function a_previously_approved_then_deactivated_account_still_gets_the_deactivated_message(): void
    {
        $user = User::factory()->create([
            'role' => 'Custodian',
            'roles' => ['Custodian'],
            'is_active' => false,
            'approved_at' => now()->subDays(10),
            'password' => bcrypt('password123'),
        ]);

        $response = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ])->assertForbidden();

        $response->assertJsonFragment(['message' => 'This account has been deactivated. Contact an administrator.']);
    }
}
