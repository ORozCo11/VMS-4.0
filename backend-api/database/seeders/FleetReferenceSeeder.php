<?php

namespace Database\Seeders;

use App\Models\VehicleCategory;
use App\Models\VehicleHub;
use Illuminate\Database\Seeder;

class FleetReferenceSeeder extends Seeder
{
    /**
     * Seed standard vehicle classifications used by dropdowns.
     */
    public function run(): void
    {
        $categories = [
            'Ambulance' => 'Land',
            'Fire Truck' => 'Land',
            'Truck' => 'Land',
            'Van' => 'Land',
            'Patrol Vehicle' => 'Land',
            'Service Vehicle' => 'Land',
            'Rescue Boat' => 'Water',
        ];

        foreach ($categories as $category => $domain) {
            VehicleCategory::updateOrCreate(
                ['category_name' => $category],
                ['domain' => $domain, 'description' => "{$category} fleet classification"],
            );
        }

        $this->seedDefaultHubs();
    }

    /**
     * Seed the fixed Paknaan vehicle hubs the fleet map/location dropdowns rely on.
     * These used to live only in frontend localStorage — moved server-side so every
     * user shares the same hub list.
     */
    private function seedDefaultHubs(): void
    {
        $hubs = [
            [
                'hub_key' => 'twinbee-hub',
                'name' => 'Twinbee Hub',
                'label' => 'TB',
                'lat' => 10.345909307605107,
                'lng' => 123.95748834311513,
                'match_names' => ['twinbee hub', 'twinbee', 'palanan central hub', 'palanan central', 'palanan'],
            ],
            [
                'hub_key' => 'paknaan-brgy-hall',
                'name' => 'Paknaan Brgy Hall',
                'label' => 'BH',
                'lat' => 10.34631777531932,
                'lng' => 123.96022810316107,
                'match_names' => ['paknaan brgy hall', 'paknaan barangay hall', 'barangay hall hub', 'brgy hall hub', 'brgy hall', 'barangay hall'],
            ],
            [
                'hub_key' => 'paknaan-gymnasium',
                'name' => 'Paknaan Gymnasium',
                'label' => 'GY',
                'lat' => 10.346474742138703,
                'lng' => 123.95854066966143,
                'match_names' => ['paknaan gymnasium', 'paknaan gymnasium hub', 'gymnasium hub', 'gymnasium', 'san isidro depot', 'san isidro', 'depot'],
            ],
        ];

        foreach ($hubs as $hub) {
            VehicleHub::updateOrCreate(
                ['hub_key' => $hub['hub_key']],
                $hub + ['is_default' => true],
            );
        }
    }
}
