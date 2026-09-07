<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleCategory;
use App\Models\VehicleHub;
use App\Models\VehicleLocation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Regression coverage for "Vehicle Location — Add Record: user doesn't have
 * ability to add new location for vehicles". The Current Location field on
 * this form used to be a plain <select> limited to hubs that already
 * existed, so logging a vehicle at a genuinely new site had nowhere to go —
 * fixed on the frontend by switching it to the same creatable-select the
 * Add Vehicle wizard already uses (type a new name + pin lat/lng, which
 * POSTs to /api/hubs first). These tests lock in the backend half of that
 * flow: every "Add Record" submit must create a NEW row (never overwrite an
 * existing one), and a location record can reference a hub that was just
 * created seconds earlier, with that hub then showing up wherever the hub
 * list is read from (i.e. the map).
 */
class VehicleLocationRecordTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'Admin', 'roles' => ['Admin']]);
    }

    private function vehicle(array $overrides = []): Vehicle
    {
        $category = VehicleCategory::create(['category_name' => 'Ambulance ' . uniqid(), 'description' => 'x']);

        return Vehicle::create(array_merge([
            'vehicle_name' => 'Ambulance Unit',
            'plate_number' => 'TST ' . random_int(1000, 9999),
            'category_id' => $category->category_id,
            'brand' => 'Toyota', 'model' => 'HiAce', 'year_model' => 2022,
            'capacity' => '12 pax', 'vehicle_color' => 'White', 'current_location' => 'Main Depot',
        ], $overrides));
    }

    #[Test]
    public function each_add_record_submit_creates_a_new_row_instead_of_overwriting_the_last_one(): void
    {
        VehicleHub::create(['hub_key' => 'main-depot', 'name' => 'Main Depot', 'label' => 'MD', 'lat' => 10.3, 'lng' => 123.9]);
        VehicleHub::create(['hub_key' => 'sub-station', 'name' => 'Sub Station', 'label' => 'SS', 'lat' => 10.4, 'lng' => 123.8]);
        $vehicle = $this->vehicle(['current_location' => 'Main Depot']);

        Sanctum::actingAs($this->admin(), ['*']);

        $this->postJson('/api/locations', [
            'vehicle_id' => $vehicle->vehicle_id,
            'current_location' => 'Sub Station',
        ])->assertCreated();

        $this->postJson('/api/locations', [
            'vehicle_id' => $vehicle->vehicle_id,
            'current_location' => 'Main Depot',
        ])->assertCreated();

        // Two "Add Record" submits => two distinct history rows, not one
        // row that got updated in place — this is the actual bug: the user
        // could only ever see/affect the single latest record.
        $this->assertSame(2, VehicleLocation::where('vehicle_id', $vehicle->vehicle_id)->count());
        $vehicle->refresh();
        $this->assertSame('Main Depot', $vehicle->current_location);
    }

    #[Test]
    public function a_location_record_can_reference_a_hub_created_moments_earlier(): void
    {
        $vehicle = $this->vehicle(['current_location' => 'Main Depot']);
        $admin = $this->admin();
        Sanctum::actingAs($admin, ['*']);

        // Mirrors the creatable-select flow: the user types a brand-new
        // place name and pins coordinates, which creates the hub first.
        $newHub = $this->postJson('/api/hubs', [
            'name' => 'New Substation',
            'lat' => 10.35,
            'lng' => 123.91,
        ])->assertCreated()->json();

        $this->postJson('/api/locations', [
            'vehicle_id' => $vehicle->vehicle_id,
            'current_location' => $newHub['name'],
        ])->assertCreated();

        $this->assertDatabaseHas('vehicle_locations', [
            'vehicle_id' => $vehicle->vehicle_id,
            'current_location' => 'New Substation',
        ]);
        $vehicle->refresh();
        $this->assertSame('New Substation', $vehicle->current_location);

        // "the newly added location shall be displayed in the map" — the
        // map's pins come from GET /api/hubs, so the new hub must be in it.
        $hubNames = collect($this->getJson('/api/hubs')->assertOk()->json())->pluck('name');
        $this->assertContains('New Substation', $hubNames);
    }

    #[Test]
    public function a_location_record_still_cannot_reference_a_hub_that_does_not_exist(): void
    {
        $vehicle = $this->vehicle(['current_location' => 'Main Depot']);
        Sanctum::actingAs($this->admin(), ['*']);

        // Regression guard: the fix must not bypass the existing
        // "current_location must be a real hub" validation rule.
        $this->postJson('/api/locations', [
            'vehicle_id' => $vehicle->vehicle_id,
            'current_location' => 'Nonexistent Place',
        ])->assertUnprocessable();

        $this->assertSame(0, VehicleLocation::where('vehicle_id', $vehicle->vehicle_id)->count());
    }

    #[Test]
    public function the_location_records_list_is_unaffected_and_still_returns_newest_first(): void
    {
        VehicleHub::create(['hub_key' => 'main-depot', 'name' => 'Main Depot', 'label' => 'MD', 'lat' => 10.3, 'lng' => 123.9]);
        VehicleHub::create(['hub_key' => 'sub-station', 'name' => 'Sub Station', 'label' => 'SS', 'lat' => 10.4, 'lng' => 123.8]);
        $vehicle = $this->vehicle(['current_location' => 'Main Depot']);
        Sanctum::actingAs($this->admin(), ['*']);

        $this->postJson('/api/locations', ['vehicle_id' => $vehicle->vehicle_id, 'current_location' => 'Sub Station'])->assertCreated();
        $this->postJson('/api/locations', ['vehicle_id' => $vehicle->vehicle_id, 'current_location' => 'Main Depot'])->assertCreated();

        $rows = $this->getJson('/api/locations')->assertOk()->json();
        $this->assertGreaterThanOrEqual(2, count($rows));
        $this->assertSame('Main Depot', $rows[0]['current_location']);
    }
}
