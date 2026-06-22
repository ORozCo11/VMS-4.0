<?php

namespace Database\Seeders;

use App\Models\VehicleCategory;
use Illuminate\Database\Seeder;

class FleetReferenceSeeder extends Seeder
{
    /**
     * Seed standard vehicle classifications used by dropdowns.
     */
    public function run(): void
    {
        $categories = [
            'Ambulance',
            'Truck',
            'Van',
            'Patrol Vehicle',
            'Motorcycle',
            'Service Vehicle',
        ];

        foreach ($categories as $category) {
            VehicleCategory::updateOrCreate(
                ['category_name' => $category],
                ['description' => "{$category} fleet classification"],
            );
        }
    }
}
