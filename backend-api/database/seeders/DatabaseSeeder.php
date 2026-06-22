<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Call your custom UserSeeder class
        $this->call([
            UserSeeder::class,
            FleetReferenceSeeder::class,
            MockDataSeeder::class,
        ]);
    }
}
