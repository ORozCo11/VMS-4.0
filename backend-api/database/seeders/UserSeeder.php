<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class UserSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Remove any other users (like Jake or Precious)
        User::whereNotIn('email', [
            'admin@barangay.gov',
            'custodian@barangay.gov',
            'maintenance@barangay.gov'
        ])->delete();

        $users = [
            [
                'name' => 'John ADmin',
                'email' => 'admin@barangay.gov',
                'password' => 'admin123',
                'role' => 'Admin',
            ],
            [
                'name' => 'Paul',
                'email' => 'custodian@barangay.gov',
                'password' => 'custodian123',
                'role' => 'Custodian',
            ],
            [
                'name' => 'orozco',
                'email' => 'maintenance@barangay.gov',
                'password' => 'maintenance123',
                'role' => 'Maintenance Personnel',
            ],
        ];

        foreach ($users as $user) {
            User::updateOrCreate(
                ['email' => $user['email']],
                [
                    'name' => $user['name'],
                    'password' => Hash::make($user['password']),
                    'role' => $user['role'],
                ],
            );
        }
    }
}
