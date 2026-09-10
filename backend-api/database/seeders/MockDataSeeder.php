<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleCategory;
use App\Models\VehicleIssueReport;
use App\Models\MaintenanceTicket;
use App\Models\TicketSubIssue;
use App\Models\TicketArchiveLog;
use App\Models\VehicleMaintenanceSchedule;
use App\Models\VehicleMaintenanceRecord;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

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
        $fireTruckCat = VehicleCategory::where('category_name', 'Fire Truck')->first();

        if (!$ambulanceCat || !$fireTruckCat) {
            $this->command->error("FleetReferenceSeeder must run first!");
            return;
        }

        // 2. Seed Vehicles
        // Same convention as FleetReferenceSeeder::seedDefaultHubs() and
        // UserSeeder — these are real Paknaan vehicles, so they're stamped
        // with Paknaan's own barangay_id. Vehicle::creating()'s auto-stamp
        // (BelongsToBarangay) only fires when Auth::check() is true, which
        // is never the case while seeding, so it must be set explicitly here
        // on every vehicle or it lands with a NULL barangay_id — invisible
        // to Paknaan's own users and, worse, visible across every tenant
        // since the global scope only filters when the acting user actually
        // has a barangay_id of their own.
        $paknaanId = Barangay::where('name', 'Paknaan')->value('id');

        $baseUrl = rtrim((string) config('app.url'), '/');

        // Resolve each vehicle mockup to a Supabase Storage URL, uploading it on
        // first run. Falls back to the locally-served /mockups path if Supabase
        // is unavailable, so seeding never hard-fails on storage issues.
        $photo = fn (string $file): string => $this->mockupUrl($file, $baseUrl);

        // Vehicle 1: Metro EMS Ambulance
        $v1 = Vehicle::updateOrCreate(
            ['plate_number' => 'AMB-1101'],
            [
                'vehicle_name'     => 'Metro EMS Ambulance',
                'category_id'      => $ambulanceCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Toyota',
                'model'            => 'HiAce Carryboy EMS',
                'year_model'       => '2023',
                'capacity'         => '1000kg',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'White / Red',
                'current_location' => 'Twinbee Hub',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/ambulance-01-hiace-carryboy.jpg'),
            ]
        );

        // Vehicle 2: INEM Portuguese Ambulance
        $v2 = Vehicle::updateOrCreate(
            ['plate_number' => 'INEM-112'],
            [
                'vehicle_name'     => 'INEM Portuguese Ambulance',
                'category_id'      => $ambulanceCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Mercedes-Benz',
                'model'            => 'Sprinter 316 CDI',
                'year_model'       => '2021',
                'capacity'         => '1200kg',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'White / Red Stripe',
                'current_location' => 'Paknaan Brgy Hall',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/ambulance-02-sprinter.jpg'),
            ]
        );

        // Vehicle 3: Rescue Response Ambulance
        $v3 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDR-303'],
            [
                'vehicle_name'     => 'Rescue Response Ambulance',
                'category_id'      => $ambulanceCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Ford',
                'model'            => 'E-450 Rescue Ambulance',
                'year_model'       => '2020',
                'capacity'         => '1300kg',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'White / Red',
                'current_location' => 'Paknaan Gymnasium',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/ambulance-03-ford-eseries.jpg'),
            ]
        );

        // Vehicle 4: Wagon Caddy Ambulance
        $v4 = Vehicle::updateOrCreate(
            ['plate_number' => 'BCP-01W'],
            [
                'vehicle_name'     => 'Wagon Caddy Ambulance',
                'category_id'      => $ambulanceCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Ford',
                'model'            => 'E-350 Box Ambulance',
                'year_model'       => '2019',
                'capacity'         => '900kg',
                'fuel_type'        => 'Gasoline',
                'vehicle_color'    => 'White / Red Stripe',
                'current_location' => 'Twinbee Hub',
                'status'           => 'Under Maintenance',
                'condition'        => 'Needs Repair',
                'photo_url'        => $photo('vehicles/ambulance-04-ford-eseries.jpg'),
            ]
        );

        // Vehicle 5: Barangay Fire Responder
        $v5 = Vehicle::updateOrCreate(
            ['plate_number' => 'BFP-5501'],
            [
                'vehicle_name'     => 'Barangay Fire Responder',
                'category_id'      => $fireTruckCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Pierce',
                'model'            => 'Enforcer Pumper',
                'year_model'       => '2018',
                'capacity'         => '2000L water tank',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red',
                'current_location' => 'Paknaan Brgy Hall',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/firetruck-01-pierce-pumper.jpg'),
            ]
        );

        // Vehicle 6: Ladder Company 28
        $v6 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDT-2801'],
            [
                'vehicle_name'     => 'Ladder Company 28',
                'category_id'      => $fireTruckCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Pierce',
                'model'            => 'Aerial Ladder Truck',
                'year_model'       => '2020',
                'capacity'         => '300 gal water tank',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red / White',
                'current_location' => 'Paknaan Gymnasium',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/firetruck-03-ladder-28.jpg'),
            ]
        );

        // Vehicle 7: Firehouse Engine 15
        $v7 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDT-1502'],
            [
                'vehicle_name'     => 'Firehouse Engine 15',
                'category_id'      => $fireTruckCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Spartan',
                'model'            => 'Metro Star Pumper',
                'year_model'       => '2019',
                'capacity'         => '1500L water tank',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red',
                'current_location' => 'Twinbee Hub',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/firetruck-04-firehouse-engine.jpg'),
            ]
        );

        // Vehicle 8: Highway Rescue Engine
        $v8 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDT-0903'],
            [
                'vehicle_name'     => 'Highway Rescue Engine',
                'category_id'      => $fireTruckCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Pierce',
                'model'            => 'Saber Pumper',
                'year_model'       => '2017',
                'capacity'         => '1800L water tank',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red',
                'current_location' => 'Paknaan Brgy Hall',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/firetruck-05-highway-engine.jpg'),
            ]
        );

        // Vehicle 9: Aerial Ladder Unit
        $v9 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDT-0704'],
            [
                'vehicle_name'     => 'Aerial Ladder Unit',
                'category_id'      => $fireTruckCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Rosenbauer',
                'model'            => 'Aerial Ladder Fire Truck',
                'year_model'       => '2021',
                'capacity'         => '1000L water tank',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red',
                'current_location' => 'Paknaan Gymnasium',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/firetruck-06-aerial-ladder.jpg'),
            ]
        );

        // Vehicle 10: London Brigade Pumper
        $v10 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDT-0605'],
            [
                'vehicle_name'     => 'London Brigade Pumper',
                'category_id'      => $fireTruckCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Volvo',
                'model'            => 'FL6 Pumper',
                'year_model'       => '2016',
                'capacity'         => '1600L water tank',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red / Yellow',
                'current_location' => 'Twinbee Hub',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/firetruck-07-volvo-fl6.jpg'),
            ]
        );

        // Vehicle 11: Engine 23
        $v11 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDT-2306'],
            [
                'vehicle_name'     => 'Engine 23',
                'category_id'      => $fireTruckCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Pierce',
                'model'            => 'Dash CF Pumper',
                'year_model'       => '2015',
                'capacity'         => '1500L water tank',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red',
                'current_location' => 'Paknaan Brgy Hall',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/firetruck-08-sffd-engine.jpg'),
            ]
        );

        // Vehicle 12: Autumn Response Pumper
        $v12 = Vehicle::updateOrCreate(
            ['plate_number' => 'FDT-1107'],
            [
                'vehicle_name'     => 'Autumn Response Pumper',
                'category_id'      => $fireTruckCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Sutphen',
                'model'            => 'Monarch Pumper',
                'year_model'       => '2022',
                'capacity'         => '1900L water tank',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'Red',
                'current_location' => 'Paknaan Gymnasium',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/firetruck-02-pumper-autumn.jpg'),
            ]
        );

        // Vehicle 13: Desert Rose EMS
        $v13 = Vehicle::updateOrCreate(
            ['plate_number' => 'AMB-2208'],
            [
                'vehicle_name'     => 'Desert Rose EMS',
                'category_id'      => $ambulanceCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Toyota',
                'model'            => 'HiAce Ambulance Conversion',
                'year_model'       => '2020',
                'capacity'         => '950kg',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'White',
                'current_location' => 'Twinbee Hub',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/ambulance-05-hiace-hilo.jpg'),
            ]
        );

        // Vehicle 14: QuickCare Ambulance
        $v14 = Vehicle::updateOrCreate(
            ['plate_number' => 'AMB-3309'],
            [
                'vehicle_name'     => 'QuickCare Ambulance',
                'category_id'      => $ambulanceCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Ford',
                'model'            => 'E-350 Type II Ambulance',
                'year_model'       => '2022',
                'capacity'         => '1000kg',
                'fuel_type'        => 'Gasoline',
                'vehicle_color'    => 'White / Red',
                'current_location' => 'Paknaan Brgy Hall',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/ambulance-06-quickcare.jpg'),
            ]
        );

        // Vehicle 15: Noida Express Ambulance
        $v15 = Vehicle::updateOrCreate(
            ['plate_number' => 'AMB-4410'],
            [
                'vehicle_name'     => 'Noida Express Ambulance',
                'category_id'      => $ambulanceCat->category_id,
                'barangay_id'      => $paknaanId,
                'brand'            => 'Mercedes-Benz',
                'model'            => 'Sprinter Ambulance Van',
                'year_model'       => '2018',
                'capacity'         => '900kg',
                'fuel_type'        => 'Diesel',
                'vehicle_color'    => 'White / Red',
                'current_location' => 'Paknaan Gymnasium',
                'status'           => 'Available',
                'condition'        => 'Good',
                'photo_url'        => $photo('vehicles/ambulance-07-noida-express.jpg'),
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
        // Ticket 1: Completed Brake Service for Portuguese Ambulance (Closed)
        $t1 = MaintenanceTicket::updateOrCreate(
            ['vehicle_id' => $v2->vehicle_id, 'ticket_title' => 'Engine Oil Change & Brake Replacement'],
            [
                'created_by'            => $admin->id,
                'ticket_description'    => 'Standard periodic service. Replace worn front brake pads and change engine oil filter.',
                'priority'              => 'Medium',
                'status'                => 'Closed',
                'assigned_custodian_id' => $custodian->id,
                'assigned_at'           => now()->subDays(3),
                'inspected_by'          => $custodian->id,
                'inspected_at'          => now()->subDays(3)->addHours(2),
                'inspection_result'     => 'Needs Maintenance',
                'inspection_notes'      => 'Confirmed brakes are worn out. Front rotors are fine, pads need replacement.',
                'closed_by'             => $admin->id,
                'closed_at'             => now()->subMinutes(30),
                'closing_notes'         => 'Repairs confirmed. Expenses approved. Vehicle ready for active duty.',
                'archived_at'           => now()->subMinutes(30),
            ]
        );

        $t1SubIssue = TicketSubIssue::updateOrCreate(
            ['ticket_id' => $t1->ticket_id, 'title' => 'Worn front brake pads & overdue oil change'],
            [
                'created_by'            => $admin->id,
                'status'                => 'Done',
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
                'final_status'        => 'Closed',
                'maintenance_cost'    => $t1SubIssue->maintenance_cost,
                'full_ticket_snapshot'=> json_encode($t1->load('subIssues')->toArray()),
                'archived_by'         => $admin->id,
                'archived_at'         => $t1->archived_at,
            ]
        );

        // Ticket 2: Reopened Work Order for Wagon Caddy Ambulance (Active)
        $t2 = MaintenanceTicket::updateOrCreate(
            ['vehicle_id' => $v4->vehicle_id, 'ticket_title' => 'AC Compressor Replacement'],
            [
                'created_by'            => $admin->id,
                'ticket_description'    => 'Reopen: Air conditioning blows warm air. Compressor clutch is not engaging.',
                'priority'              => 'High',
                'status'                => 'Active',
                'assigned_custodian_id' => $custodian->id,
                'assigned_at'           => now()->subDays(4),
                'inspected_by'          => $custodian->id,
                'inspected_at'          => now()->subDays(4)->addHours(1),
                'inspection_result'     => 'Needs Maintenance',
                'inspection_notes'      => 'A/C is completely blowing ambient hot air. Clutch plate is frozen.',
            ]
        );

        TicketSubIssue::updateOrCreate(
            ['ticket_id' => $t2->ticket_id, 'title' => 'AC compressor clutch not engaging'],
            [
                'created_by'            => $admin->id,
                'status'                => 'Under Repair',
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
                'confirmation_verdict'  => 'Reopened',
                'confirmation_notes'    => 'The A/C is still blowing warm air. Please check the electrical connections and ensure the compressor clutch is engaging properly.',
                'confirmed_by'          => $admin->id,
                'confirmed_at'          => now()->subHours(1),
                'reopened_by'           => $admin->id,
                'reopened_at'           => now()->subHours(1),
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

    /**
     * Upload a bundled vehicle mockup to Supabase Storage (once) and return its
     * public URL. Falls back to the locally-served /mockups path if Supabase is
     * not configured or unreachable, so seeding never hard-fails on storage.
     * Path is relative to public/mockups/ — e.g. 'vehicles/ambulance-01.jpg'.
     */
    private function mockupUrl(string $path, string $baseUrl): string
    {
        $localPath = public_path('mockups/' . $path);

        // Content-type by extension — the real photo mockups are jpg, the
        // original icon set was svg; guessing from the extension keeps this
        // working for either without hardcoding one format.
        $mimeByExtension = [
            'svg' => 'image/svg+xml',
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png' => 'image/png',
        ];
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $mimetype = $mimeByExtension[$extension] ?? 'application/octet-stream';

        try {
            $disk = Storage::disk('supabase');
            // $path already includes its own subfolder (e.g. 'vehicles/...') —
            // used as-is, not nested under another 'vehicles/' prefix.
            $remotePath = $path;

            if (!$disk->exists($remotePath)) {
                $disk->put($remotePath, file_get_contents($localPath), ['mimetype' => $mimetype]);
            }

            $publicBase = rtrim((string) config('filesystems.disks.supabase.url'), '/');
            return $publicBase . '/' . $remotePath;
        } catch (\Throwable $e) {
            $this->command->warn("Supabase upload failed for {$path}; using local mockup. ({$e->getMessage()})");
            return $baseUrl . '/mockups/' . $path;
        }
    }
}
