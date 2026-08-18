<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\City;
use Illuminate\Database\Seeder;

class BarangayBoundarySeeder extends Seeder
{
    /**
     * A few barangay names differ slightly between our seeded list and the
     * PSGC source's official spelling/formatting.
     */
    private const NAME_ALIASES = [
        'centro' => 'Centro (Poblacion)',
        'pakna-an' => 'Paknaan',
    ];

    private static function normalize(string $name): string
    {
        return strtolower(preg_replace('/[^a-z0-9]/i', '', $name));
    }

    /**
     * Seed the application's database. Must run after BarangaySeeder.
     */
    public function run(): void
    {
        $mandaueCityId = City::where('name', 'Mandaue City')->value('id');

        if (!$mandaueCityId) {
            return;
        }

        $path = database_path('data/mandaue-barangay-boundaries.json');
        $geojson = json_decode(file_get_contents($path), true);

        $barangaysByNormalizedName = Barangay::where('city_id', $mandaueCityId)
            ->get()
            ->keyBy(fn ($barangay) => self::normalize($barangay->name));

        $updated = 0;
        foreach ($geojson['features'] as $feature) {
            $sourceName = $feature['properties']['adm4_en'] ?? null;
            if (!$sourceName) {
                continue;
            }

            $key = self::normalize(self::NAME_ALIASES[strtolower($sourceName)] ?? $sourceName);
            $barangay = $barangaysByNormalizedName->get($key);

            if (!$barangay) {
                continue;
            }

            $barangay->update(['boundary' => $feature['geometry']]);
            $updated++;
        }

        $this->command?->info("Barangay boundaries linked: {$updated}");
    }
}
