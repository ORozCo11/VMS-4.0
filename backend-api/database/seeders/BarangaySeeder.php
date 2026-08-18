<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\City;
use Illuminate\Database\Seeder;

class BarangaySeeder extends Seeder
{
    /**
     * The 27 barangays of Mandaue City, Cebu — the LGU this VMS instance
     * serves (see the Paknaan hub/map data already in the frontend).
     */
    private const BARANGAYS = [
        'Alang-alang',
        'Bakilid',
        'Banilad',
        'Basak',
        'Cabancalan',
        'Cambaro',
        'Canduman',
        'Casili',
        'Casuntingan',
        'Centro (Poblacion)',
        'Cubacub',
        'Guizo',
        'Ibabao-Estancia',
        'Jagobiao',
        'Labogon',
        'Looc',
        'Maguikay',
        'Mantuyong',
        'Opao',
        'Pagsabungan',
        'Paknaan',
        'Subangdaku',
        'Tabok',
        'Tawason',
        'Tingub',
        'Tipolo',
        'Umapad',
    ];

    /**
     * Seed the application's database. Must run after CitySeeder — links
     * every barangay to the "Mandaue City" row so the Register form can
     * tell which selected city has a real barangay list to offer.
     */
    public function run(): void
    {
        $mandaueCityId = City::where('name', 'Mandaue City')->value('id');

        foreach (self::BARANGAYS as $name) {
            $barangay = Barangay::firstOrCreate(['name' => $name]);
            $barangay->update(['city_id' => $mandaueCityId]);
        }
    }
}
