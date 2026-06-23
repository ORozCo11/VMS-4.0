<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleCategory;
use App\Models\VehicleIssueReport;
use App\Models\MaintenanceTicket;
use App\Models\TicketArchiveLog;
use App\Models\VehicleMaintenanceSchedule;
use App\Models\VehicleMaintenanceRecord;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class MockDataSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // 1. Fetch references
        $admin = User::where('role', 'Admin')->first();
        $custodian = User::where('role', 'Custodian')->first();
        $mechanic = User::where('role', 'Maintenance Personnel')->first();

        if (!$admin || !$custodian || !$mechanic) {
            $this->command->error("Standard users (Admin, Custodian, Mechanic) must be seeded first!");
            return;
        }

        $ambulanceCat = VehicleCategory::where('category_name', 'Ambulance')->first();
        $truckCat = VehicleCategory::where('category_name', 'Truck')->first();

        if (!$ambulanceCat || !$truckCat) {
            $this->command->error("FleetReferenceSeeder must run first!");
            return;
        }

        // 2. Seed Vehicles
        $baseUrl = rtrim((string) config('app.url'), '/');

        // Vehicle 1: AmbuLanz (Lego Model)
        $v1 = Vehicle::updateOrCreate(
            ['plate_number' => 'JSFSD-242'],
            [
                'vehicle_name'     => 'AmbuLanz (Lego Model)',
                'category_id'      => $ambulanceCat->category_id,
                'brand'            => 'Lego Creator',
                'model'            => 'EMS Ambulance 4431',
                'year_model'       => '2024',
                'capacity'         => '400kg',
                'fuel_type'        => 'Electric',
                'vehicle_color'    => 'White / Blue',
                'current_location' => 'Palanan Central Hub',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $baseUrl . '/mockups/ambulance-blue.svg',
            ]
        );

        // Vehicle 2: INEM Portuguese Ambulance
        $v2 = Vehicle::updateOrCreate(
            ['plate_number' => 'INEM-112'],
            [
                'vehicle_name'     => 'INEM Portuguese Ambulance',
                'category_id'      => $ambulanceCat->category_id,
                'brand'            => 'Mercedes-Benz',
                'model'            => 'Sprinter 316 CDI',
                'year_model'       => '2021',
                'capacity'         => '1200kg',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Yellow',
                'current_location' => 'Barangay Hall Hub',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $baseUrl . '/mockups/ambulance-yellow.svg',
            ]
        );

        // Vehicle 3: Rescue Patrol Truck
        $v3 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDR-303'],
            [
                'vehicle_name'     => 'Rescue Patrol Truck',
                'category_id'      => $truckCat->category_id,
                'brand'            => 'Ford',
                'model'            => 'F-550 Rescue Super Duty',
                'year_model'       => '2020',
                'capacity'         => '3500kg',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red / White',
                'current_location' => 'San Isidro Depot',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $baseUrl . '/mockups/rescue-truck.svg',
            ]
        );

        // Vehicle 4: Wagon Caddy Ambulance
        $v4 = Vehicle::updateOrCreate(
            ['plate_number' => 'BCP-01W'],
            [
                'vehicle_name'     => 'Wagon Caddy Ambulance',
                'category_id'      => $ambulanceCat->category_id,
                'brand'            => 'Volkswagen',
                'model'            => 'Caddy Life Maxi',
                'year_model'       => '2019',
                'capacity'         => '800kg',
                'fuel_type'        => 'Gasoline',
                'vehicle_color'    => 'White / Red Stripe',
                'current_location' => 'Palanan Central Hub',
                'status'           => 'Under Maintenance',
                'condition'        => 'Needs Repair',
                'photo_url'        => $baseUrl . '/mockups/ambulance-wagon.svg',
            ]
        );

        // 3. Seed Issue Reports
        // Resolved Issue Report for Portuguese Ambulance
        $issue1 = VehicleIssueReport::updateOrCreate(
            ['vehicle_id' => $v2->vehicle_id, 'issue_type' => 'Brake grinding noise'],
            [
                'issue_description' => 'Squealing and grinding noise when applying brakes. Stopping distance seems slightly increased.',
                'severity_level'    => 'High',
                'reported_by'       => $custodian->id,
                'status'            => 'Resolved',
                'remarks'           => 'Resolved via Ticket workflow.'
            ]
        );

        // Active Issue Report for Patrol Truck
        $issue2 = VehicleIssueReport::updateOrCreate(
            ['vehicle_id' => $v3->vehicle_id, 'issue_type' => 'Warm Air from AC'],
            [
                'issue_description' => 'Cabin air conditioning blows warm air even when set to maximum cooling. Probably refrigerant leak or belt issue.',
                'severity_level'    => 'Medium',
                'reported_by'       => $custodian->id,
                'status'            => 'Pending',
                'photo_url'        => $baseUrl . '/mockups/issue-attachment.png',
            ]
        );

        // 4. Seed Maintenance Tickets
        // Ticket 1: Completed Brake Service for Portuguese Ambulance (Done)
        $t1 = MaintenanceTicket::updateOrCreate(
            ['vehicle_id' => $v2->vehicle_id, 'ticket_title' => 'Engine Oil Change & Brake Replacement'],
            [
                'created_by'            => $admin->id,
                'ticket_description'    => 'Standard periodic service. Replace worn front brake pads and change engine oil filter.',
                'priority'              => 'Medium',
                'status'                => 'Done',
                'assigned_custodian_id' => $custodian->id,
                'assigned_at'           => now()->subDays(3),
                'inspected_by'          => $custodian->id,
                'inspected_at'          => now()->subDays(3)->addHours(2),
                'inspection_result'     => 'Needs Maintenance',
                'inspection_notes'      => 'Confirmed brakes are worn out. Front rotors are fine, pads need replacement.',
                'assigned_mechanic_id'  => $mechanic->id,
                'maintenance_type'      => 'Brake Repair',
                'work_order_notes'      => 'Replace front brake pads and log standard 10,000km PMS oil change.',
                'mechanic_assigned_at'  => now()->subDays(2),
                'mechanic_assigned_by'  => $admin->id,
                'repair_logs'           => "[2026-06-11 09:00] Drained engine oil, replaced oil filter.\n[2026-06-11 10:15] Replaced front brake pads with OEM spares. Tested brake pressure.",
                'parts_used'            => 'Brake Pads (OEM), Synthetic Oil 5W-30 (5 Liters), Oil Filter',
                'repair_started_at'     => now()->subDays(2)->format('Y-m-d'),
                'repair_completed_at'   => now()->subDays(1)->format('Y-m-d'),
                'maintenance_cost'      => 5400.00,
                'verification_verdict'  => 'Approved',
                'verification_notes'    => 'Road tested ambulance. Brake response is now sharp. Aircon filter also cleaned.',
                'verified_by'           => $custodian->id,
                'verified_at'           => now()->subDays(1)->addHours(3),
                'confirmation_verdict'  => 'Confirmed',
                'confirmation_notes'    => 'Repairs confirmed. Expenses approved. Vehicle ready for active duty.',
                'confirmed_by'          => $admin->id,
                'confirmed_at'          => now()->subMinutes(30),
                'archived_at'           => now()->subMinutes(30),
            ]
        );

        // Trigger Phase 5 Archive creation for completed Ticket 1
        TicketArchiveLog::updateOrCreate(
            ['ticket_id' => $t1->ticket_id],
            [
                'vehicle_id'          => $v2->vehicle_id,
                'ticket_title'        => $t1->ticket_title,
                'vehicle_name'        => $v2->vehicle_name,
                'plate_number'        => $v2->plate_number,
                'final_status'        => 'Done',
                'maintenance_cost'    => $t1->maintenance_cost,
                'full_ticket_snapshot'=> json_encode($t1->toArray()),
                'archived_by'         => $admin->id,
                'archived_at'         => $t1->archived_at,
            ]
        );

        // Ticket 2: Reopened Work Order for Wagon Caddy Ambulance (Under Repair)
        $t2 = MaintenanceTicket::updateOrCreate(
            ['vehicle_id' => $v4->vehicle_id, 'ticket_title' => 'AC Compressor Replacement'],
            [
                'created_by'            => $admin->id,
                'ticket_description'    => 'Reopen: Air conditioning blows warm air. Compressor clutch is not engaging.',
                'priority'              => 'High',
                'status'                => 'Under Repair',
                'assigned_custodian_id' => $custodian->id,
                'assigned_at'           => now()->subDays(4),
                'inspected_by'          => $custodian->id,
                'inspected_at'          => now()->subDays(4)->addHours(1),
                'inspection_result'     => 'Needs Maintenance',
                'inspection_notes'      => 'A/C is completely blowing ambient hot air. Clutch plate is frozen.',
                'assigned_mechanic_id'  => $mechanic->id,
                'maintenance_type'      => 'Engine Repair',
                'work_order_notes'      => 'Replace A/C Compressor assembly and recharge system with R134a refrigerant.',
                'mechanic_assigned_at'  => now()->subDays(3),
                'mechanic_assigned_by'  => $admin->id,
                'repair_logs'           => "[2026-06-12 09:15] Installed replacement Sanden A/C Compressor. Recharged system.",
                'parts_used'            => 'AC Compressor Unit, R134a Refrigerant Gas',
                'repair_started_at'     => now()->subDays(2)->format('Y-m-d'),
                'repair_completed_at'   => null,
                'maintenance_cost'      => 8500.00,
                'verification_verdict'  => null,
                'verification_notes'    => null,
                'verified_by'           => null,
                'verified_at'           => null,
                'confirmation_verdict'  => 'Reopened',
                'confirmation_notes'    => 'The A/C is still blowing warm air. Please check the electrical connections and ensure the compressor clutch is engaging properly.',
                'confirmed_by'          => $admin->id,
                'confirmed_at'          => now()->subHours(1),
            ]
        );

        // 5. Seed Maintenance Schedules
        VehicleMaintenanceSchedule::updateOrCreate(
            ['vehicle_id' => $v1->vehicle_id, 'maintenance_type' => 'Routine Maintenance'],
            [
                'scheduled_date'   => now()->addDays(3)->format('Y-m-d'),
                'scheduled_time'   => '09:00:00',
                'service_location' => 'Palanan Central Hub',
                'status'           => 'Scheduled',
                'created_by'       => $admin->id,
                'notes'            => 'Routine 5,000km checkup and wheel alignment.',
            ]
        );

        VehicleMaintenanceSchedule::updateOrCreate(
            ['vehicle_id' => $v3->vehicle_id, 'maintenance_type' => 'Tire Replacement'],
            [
                'scheduled_date'   => now()->addDays(8)->format('Y-m-d'),
                'scheduled_time'   => '13:30:00',
                'service_location' => 'San Isidro Depot',
                'status'           => 'Scheduled',
                'created_by'       => $admin->id,
                'notes'            => 'Replace rear tires and check tire pressure monitoring sensors.',
            ]
        );

        // 6. Seed Maintenance Records (manual log)
        VehicleMaintenanceRecord::updateOrCreate(
            ['vehicle_id' => $v1->vehicle_id, 'maintenance_type' => 'Tire Rotation'],
            [
                'problem_reason'            => 'Planned rotation for even tread wear.',
                'action_taken'              => 'Rotated tires front-to-back. Balanced wheels.',
                'maintenance_personnel_id'  => $mechanic->id,
                'progress_status'           => 'Completed',
                'verification_result'       => 'Passed',
                'date_started'              => now()->subDays(10)->format('Y-m-d'),
                'date_completed'            => now()->subDays(10)->format('Y-m-d'),
            ]
        );
    }
}
