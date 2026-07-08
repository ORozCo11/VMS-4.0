<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\UploadsImages;
use App\Models\ActivityLog;
use App\Models\MaintenanceTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleCategory;
use App\Models\VehicleConditionCheck;
use App\Models\VehicleHistory;
use App\Models\VehicleHub;
use App\Models\VehicleIssueReport;
use App\Models\VehicleLocation;
use App\Models\VehicleMaintenanceRecord;
use App\Models\VehicleMaintenanceSchedule;
use App\Rules\NumberOnly;
use App\Rules\TextOnly;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class FleetController extends Controller
{
    use UploadsImages;

    private array $issueTypes = [
        'Engine Problem',
        'Brake Problem',
        'Tire Problem',
        'Battery Problem',
        'Electrical Problem',
        'Fuel Problem',
        'Body Damage',
        'Overheating',
        'Lights / Siren Problem',
        'Other',
    ];

    private array $maintenanceTypes = [
        'General Inspection',
        'Preventive Maintenance',
        'Engine Repair',
        'Brake Repair',
        'Tire Replacement',
        'Tire Rotation',
        'Battery Replacement',
        'Oil Change',
        'Electrical Repair',
        'Body Repair',
        'Other',
    ];

    public function lookups()
    {
        $this->syncVehicleStatuses();
        return response()->json([
            'categories' => VehicleCategory::orderBy('category_name')->get(),
            'vehicles' => Vehicle::with('category')->orderBy('vehicle_name')->get(),
            'issue_reports' => VehicleIssueReport::with('vehicle')
                ->whereNot('status', 'Resolved')
                ->latest('issue_report_id')
                ->get(),
            'maintenance_personnel' => User::where('role', 'Maintenance Personnel')
                ->orderBy('name')
                ->get(['id', 'name', 'email', 'role']),
            'issue_types' => $this->issueTypes,
            'maintenance_types' => $this->maintenanceTypes,
            'severity_levels' => ['Low', 'Medium', 'High', 'Critical'],
            'vehicle_statuses' => ['Available', 'In Use', 'Under Maintenance', 'Inactive'],
            'condition_results' => ['Good', 'Needs Inspection', 'Needs Repair', 'Damaged'],
            'issue_statuses' => ['Pending', 'Under Review', 'In Maintenance', 'Resolved'],
            'maintenance_statuses' => ['Assigned', 'Under Repair', 'For Verification', 'Completed'],
            'schedule_statuses' => ['Scheduled', 'Completed', 'Cancelled'],
        ]);
    }

    public function dashboard(Request $request)
    {
        $this->syncVehicleStatuses();
        $role = $request->user()->role;
        $activeIssues = VehicleIssueReport::whereNot('status', 'Resolved')->count();
        $upcomingMaintenance = VehicleMaintenanceSchedule::where('status', 'Scheduled')
            ->whereDate('scheduled_date', '>=', now()->toDateString())
            ->count();

        $metrics = [
            ['label' => 'Total Vehicles', 'value' => Vehicle::count()],
            ['label' => 'Available Vehicles', 'value' => Vehicle::where('status', 'Available')->count()],
            ['label' => 'Vehicles Under Maintenance', 'value' => Vehicle::where('status', 'Under Maintenance')->count()],
        ];

        if ($role === 'Admin') {
            $metrics[] = ['label' => 'Inactive Vehicles', 'value' => Vehicle::where('status', 'Inactive')->count()];
            $metrics[] = ['label' => 'Reported Issues', 'value' => $activeIssues];
            $metrics[] = ['label' => 'Upcoming Maintenance', 'value' => $upcomingMaintenance];
            
            $totalExpenses = \App\Models\TicketArchiveLog::sum('maintenance_cost');
            $metrics[] = [
                'label' => 'Total Maintenance Expenses',
                'value' => '₱' . number_format($totalExpenses, 2)
            ];
        }

        if ($role === 'Custodian') {
            $metrics[] = ['label' => 'Reported Issues', 'value' => $activeIssues];
            $metrics[] = [
                'label' => 'My Reported Issues',
                'value' => VehicleIssueReport::where('reported_by', $request->user()->id)->count(),
            ];
        }

        if ($role === 'Maintenance Personnel') {
            $metrics = [
                ['label' => 'Reported Vehicle Issues', 'value' => $activeIssues],
                ['label' => 'Maintenance Records', 'value' => VehicleMaintenanceRecord::count()],
                ['label' => 'Upcoming Maintenance', 'value' => $upcomingMaintenance],
                [
                    'label' => 'Recently Completed Maintenance',
                    'value' => VehicleMaintenanceRecord::where('progress_status', 'Completed')
                        ->whereDate('updated_at', '>=', now()->subDays(30)->toDateString())
                        ->count(),
                ],
                [
                    'label' => 'Vehicles Needing Attention',
                    'value' => Vehicle::whereIn('condition', ['Needs Inspection', 'Needs Repair', 'Damaged'])->count(),
                ],
            ];
        }

        return response()->json([
            'metrics' => $metrics,
            'badge_counts' => [
                'issues' => $activeIssues,
                'tickets' => MaintenanceTicket::whereNotIn('status', ['Done', 'Cancelled'])->count(),
                'conditions' => Vehicle::whereIn('condition', ['Needs Inspection', 'Needs Repair', 'Damaged'])->count(),
                'schedules' => $upcomingMaintenance,
                'ticketInspections' => MaintenanceTicket::where('assigned_custodian_id', $request->user()->id)
                    ->where('status', 'Open')
                    ->count(),
                'ticketVerifications' => MaintenanceTicket::where('assigned_custodian_id', $request->user()->id)
                    ->where('status', 'For Inspection')
                    ->count(),
            ],
            'vehicles_by_type' => Vehicle::query()
                ->join('vehicle_categories', 'vehicles.category_id', '=', 'vehicle_categories.category_id')
                ->selectRaw('vehicle_categories.category_name as label, count(*) as value')
                ->groupBy('vehicle_categories.category_name')
                ->orderBy('vehicle_categories.category_name')
                ->get(),
            'vehicles_by_location' => Vehicle::query()
                ->selectRaw('current_location as label, count(*) as value')
                ->groupBy('current_location')
                ->orderBy('current_location')
                ->get(),
            'recent_updates' => VehicleHistory::with(['vehicle', 'updatedBy'])
                ->latest('history_id')
                ->limit(8)
                ->get(),
            'activity_by_day' => $this->activityByDay(14),
        ]);
    }

    /**
     * Fleet activity (history events) per day over the last $days days.
     * Missing days are filled with 0 so the chart line stays continuous.
     */
    private function activityByDay(int $days = 14): array
    {
        $start = now()->subDays($days - 1)->startOfDay();

        $counts = VehicleHistory::query()
            ->where('created_at', '>=', $start)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as total')
            ->groupBy('day')
            ->pluck('total', 'day');

        $series = [];
        for ($i = 0; $i < $days; $i++) {
            $date = $start->copy()->addDays($i);
            $key = $date->toDateString();
            $series[] = [
                'label' => $date->format('M j'),
                'value' => (int) ($counts[$key] ?? 0),
            ];
        }

        return $series;
    }

    public function categories()
    {
        return VehicleCategory::withCount('vehicles')->orderBy('category_name')->get();
    }

    public function storeCategory(Request $request)
    {
        $this->requireRole($request, ['Admin']);

        $data = $request->validate([
            'category_name' => ['required', 'string', 'max:255', 'unique:vehicle_categories,category_name'],
            'domain' => ['required', 'in:Land,Water'],
            'description' => ['nullable', 'string'],
        ]);

        $category = VehicleCategory::create($data);
        $this->log($request, 'Add', 'Vehicle Categories', $category->category_id, "Added vehicle type {$category->category_name}");

        return response()->json($category, 201);
    }

    public function updateCategory(Request $request, VehicleCategory $category)
    {
        $this->requireRole($request, ['Admin']);

        $data = $request->validate([
            'category_name' => [
                'required',
                'string',
                'max:255',
                Rule::unique('vehicle_categories', 'category_name')->ignore($category->category_id, 'category_id'),
            ],
            'domain' => ['required', 'in:Land,Water'],
            'description' => ['nullable', 'string'],
        ]);

        $category->update($data);
        $this->log($request, 'Edit', 'Vehicle Categories', $category->category_id, "Updated vehicle type {$category->category_name}");

        return $category;
    }

    public function deleteCategory(Request $request, VehicleCategory $category)
    {
        $this->requireRole($request, ['Admin']);

        abort_if($category->vehicles()->exists(), 422, 'This category is still assigned to one or more vehicles.');

        $this->log($request, 'Delete', 'Vehicle Categories', $category->category_id, "Deleted vehicle type {$category->category_name}");
        $category->delete();

        return response()->json(['message' => 'Vehicle category deleted.']);
    }

    public function vehicles(Request $request)
    {
        $this->syncVehicleStatuses();
        $query = Vehicle::with(['category', 'archivedBy']);

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(function ($nested) use ($search) {
                $nested->where('vehicle_name', 'like', "%{$search}%")
                    ->orWhere('plate_number', 'like', "%{$search}%")
                    ->orWhere('brand', 'like', "%{$search}%")
                    ->orWhere('model', 'like', "%{$search}%");
            });
        }

        $query->when($request->filled('category_id'), fn ($q) => $q->where('category_id', $request->category_id))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->status))
            ->when($request->filled('location'), fn ($q) => $q->where('current_location', $request->location));

        return $query->latest('vehicle_id')->get();
    }

    public function storeVehicle(Request $request)
    {
        $this->requireRole($request, ['Admin']);

        $data = $this->validateVehicle($request);

        if ($request->hasFile('photo')) {
            $data['photo_url'] = $this->storeVehiclePhoto($request->file('photo'));
        }

        unset($data['photo']);

        $vehicle = DB::transaction(function () use ($data, $request) {
            $vehicle = Vehicle::create($data + [
                'status' => 'Available',
                'condition' => 'Good',
            ]);

            $this->history($vehicle, 'Vehicle Added', "{$vehicle->vehicle_name} was added to the system.", 'vehicles', $vehicle->vehicle_id, $request);
            $this->log($request, 'Add', 'Vehicle Management', $vehicle->vehicle_id, "Added vehicle {$vehicle->vehicle_name}");

            return $vehicle;
        });

        return response()->json($vehicle->load('category'), 201);
    }

    public function updateVehicle(Request $request, Vehicle $vehicle)
    {
        $this->requireRole($request, ['Admin']);

        $data = $this->validateVehicle($request, $vehicle);

        if ($request->hasFile('photo')) {
            $data['photo_url'] = $this->storeVehiclePhoto($request->file('photo'));
        }

        unset($data['photo']);

        DB::transaction(function () use ($vehicle, $data, $request) {
            $vehicle->update($data);
            $this->history($vehicle, 'Vehicle Information Updated', "{$vehicle->vehicle_name} information was updated.", 'vehicles', $vehicle->vehicle_id, $request);
            $this->log($request, 'Edit', 'Vehicle Management', $vehicle->vehicle_id, "Updated vehicle {$vehicle->vehicle_name}");
        });

        return $vehicle->fresh('category');
    }

    public function archiveVehicle(Request $request, Vehicle $vehicle)
    {
        $this->requireRole($request, ['Admin']);

        $vehicle->update([
            'status' => 'Inactive',
            'archived_at' => now(),
            'archived_by' => $request->user()->id,
        ]);
        $this->history($vehicle, 'Vehicle Archived', "{$vehicle->vehicle_name} was marked inactive.", 'vehicles', $vehicle->vehicle_id, $request);
        $this->log($request, 'Delete', 'Vehicle Management', $vehicle->vehicle_id, "Archived vehicle {$vehicle->vehicle_name}");

        return response()->json(['message' => 'Vehicle archived.']);
    }

    public function restoreVehicle(Request $request, Vehicle $vehicle)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless($vehicle->status === 'Inactive', 422, 'Vehicle is not archived.');

        $vehicle->update([
            'status' => 'Available',
            'archived_at' => null,
            'archived_by' => null,
        ]);
        $this->history($vehicle, 'Vehicle Restored', "{$vehicle->vehicle_name} was restored to active service.", 'vehicles', $vehicle->vehicle_id, $request);
        $this->log($request, 'Edit', 'Vehicle Management', $vehicle->vehicle_id, "Restored vehicle {$vehicle->vehicle_name}");

        return response()->json($vehicle->fresh(['category', 'archivedBy']));
    }

    public function locations(Request $request)
    {
        $query = VehicleLocation::with(['vehicle.category', 'updatedBy']);

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(function ($nested) use ($search) {
                $nested->where('current_location', 'like', "%{$search}%")
                    ->orWhere('address_area', 'like', "%{$search}%");
            });
        }

        return $query->latest('location_record_id')->get();
    }

    public function storeLocation(Request $request)
    {
        $this->requireRole($request, ['Admin']);

        $data = $request->validate([
            'vehicle_id' => ['required', 'exists:vehicles,vehicle_id'],
            'current_location' => ['required', 'string', 'max:255', Rule::in(VehicleHub::pluck('name'))],
            'address_area' => ['nullable', 'string', 'max:255'],
            'remarks' => ['nullable', 'string'],
        ]);

        $location = DB::transaction(function () use ($data, $request) {
            $vehicle = Vehicle::findOrFail($data['vehicle_id']);
            $location = VehicleLocation::create($data + ['updated_by' => $request->user()->id]);
            $vehicle->update(['current_location' => $data['current_location']]);

            $this->history($vehicle, 'Location Updated', "{$vehicle->vehicle_name} current location was updated to {$data['current_location']}.", 'vehicle_locations', $location->location_record_id, $request);
            $this->log($request, 'Edit', 'Vehicle Location', $location->location_record_id, "Updated location for {$vehicle->vehicle_name}");

            return $location;
        });

        return response()->json($location->load(['vehicle.category', 'updatedBy']), 201);
    }

    public function conditions(Request $request)
    {
        $query = VehicleConditionCheck::with(['vehicle.category', 'checkedBy']);

        $query->when($request->filled('vehicle_id'), fn ($q) => $q->where('vehicle_id', $request->vehicle_id))
            ->when($request->filled('condition_result'), fn ($q) => $q->where('condition_result', $request->condition_result));

        return $query->latest('condition_check_id')->get();
    }

    public function storeCondition(Request $request)
    {
        $this->requireRole($request, ['Admin', 'Custodian']);

        $data = $request->validate([
            'vehicle_id' => ['required', 'exists:vehicles,vehicle_id'],
            'condition_result' => ['required', Rule::in(['Good', 'Needs Inspection', 'Needs Repair', 'Damaged'])],
            'observations' => ['nullable', 'string'],
            'remarks' => ['nullable', 'string'],
        ]);

        $condition = DB::transaction(function () use ($data, $request) {
            $vehicle = Vehicle::findOrFail($data['vehicle_id']);
            $condition = VehicleConditionCheck::create($data + ['checked_by' => $request->user()->id]);

            $vehicleStatus = in_array($data['condition_result'], ['Needs Repair', 'Damaged'], true)
                ? 'Under Maintenance'
                : $vehicle->status;

            $vehicle->update([
                'condition' => $data['condition_result'],
                'status' => $vehicleStatus,
            ]);

            $this->history($vehicle, 'Condition Checked', "{$vehicle->vehicle_name} condition was marked {$data['condition_result']}.", 'vehicle_condition_checks', $condition->condition_check_id, $request);
            $this->log($request, 'Add', 'Vehicle Condition Monitoring', $condition->condition_check_id, "Recorded condition for {$vehicle->vehicle_name}");

            return $condition;
        });

        return response()->json($condition->load(['vehicle.category', 'checkedBy']), 201);
    }

    public function updateCondition(Request $request, VehicleConditionCheck $condition)
    {
        $this->requireRole($request, ['Admin', 'Custodian']);

        $data = $request->validate([
            'vehicle_id' => ['sometimes', 'exists:vehicles,vehicle_id'],
            'condition_result' => ['sometimes', Rule::in(['Good', 'Needs Inspection', 'Needs Repair', 'Damaged'])],
            'observations' => ['nullable', 'string'],
            'remarks' => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($condition, $data, $request) {
            $condition->update($data);

            if (isset($data['condition_result'])) {
                $vehicle = $condition->vehicle;
                $vehicleStatus = in_array($data['condition_result'], ['Needs Repair', 'Damaged'], true)
                    ? 'Under Maintenance'
                    : $vehicle->status;

                $vehicle->update([
                    'condition' => $data['condition_result'],
                    'status' => $vehicleStatus,
                ]);
            }

            $this->history($condition->vehicle, 'Condition Check Updated', "Updated condition check #{$condition->condition_check_id} to {$condition->condition_result}.", 'vehicle_condition_checks', $condition->condition_check_id, $request);
            $this->log($request, 'Edit', 'Vehicle Condition Monitoring', $condition->condition_check_id, "Updated condition check for {$condition->vehicle->vehicle_name}");
        });

        return $condition->load(['vehicle.category', 'checkedBy']);
    }

    public function deleteCondition(Request $request, VehicleConditionCheck $condition)
    {
        $this->requireRole($request, ['Admin', 'Custodian']);

        DB::transaction(function () use ($condition, $request) {
            $vehicle = $condition->vehicle;
            $condition->delete();

            // Revert vehicle condition to latest remaining check, if any
            $latestCheck = VehicleConditionCheck::where('vehicle_id', $vehicle->vehicle_id)
                ->latest('condition_check_id')
                ->first();

            if ($latestCheck) {
                $vehicleStatus = in_array($latestCheck->condition_result, ['Needs Repair', 'Damaged'], true)
                    ? 'Under Maintenance'
                    : $vehicle->status;

                $vehicle->update([
                    'condition' => $latestCheck->condition_result,
                    'status' => $vehicleStatus,
                ]);
            } else {
                $vehicle->update([
                    'condition' => 'Good',
                ]);
            }

            $this->history($vehicle, 'Condition Check Deleted', "Deleted condition check record.", 'vehicles', $vehicle->vehicle_id, $request);
            $this->log($request, 'Delete', 'Vehicle Condition Monitoring', $condition->condition_check_id, "Deleted condition check for {$vehicle->vehicle_name}");
        });

        return response()->json(['message' => 'Condition check deleted.']);
    }

    public function issues(Request $request)
    {
        $query = VehicleIssueReport::with(['vehicle.category', 'reportedBy']);

        if ($request->boolean('mine')) {
            $query->where('reported_by', $request->user()->id);
        }

        $query->when($request->filled('status'), fn ($q) => $q->where('status', $request->status))
            ->when($request->filled('severity_level'), fn ($q) => $q->where('severity_level', $request->severity_level))
            ->when($request->filled('issue_type'), fn ($q) => $q->where('issue_type', $request->issue_type));

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(function ($nested) use ($search) {
                $nested->where('issue_type', 'like', "%{$search}%")
                    ->orWhere('issue_description', 'like', "%{$search}%")
                    ->orWhereHas('vehicle', function ($vehicleQuery) use ($search) {
                        $vehicleQuery->where('vehicle_name', 'like', "%{$search}%")
                            ->orWhere('plate_number', 'like', "%{$search}%");
                    });
            });
        }

        return $query->latest('issue_report_id')->get();
    }

    public function storeIssue(Request $request)
    {
        $this->requireRole($request, ['Admin', 'Custodian']);

        $data = $request->validate([
            'vehicle_id' => ['required', 'exists:vehicles,vehicle_id'],
            'issue_type' => ['required', Rule::in($this->issueTypes)],
            'issue_description' => ['required', 'string'],
            'severity_level' => ['required', Rule::in(['Low', 'Medium', 'High', 'Critical'])],
            'photo' => ['nullable', 'image', 'max:4096'],
            'remarks' => ['nullable', 'string'],
        ]);

        if ($request->hasFile('photo')) {
            $data['photo_url'] = $this->storeUploadedImage($request->file('photo'), 'issue-attachments');
        }

        unset($data['photo']);

        $issue = DB::transaction(function () use ($data, $request) {
            $vehicle = Vehicle::findOrFail($data['vehicle_id']);
            $issue = VehicleIssueReport::create($data + [
                'reported_by' => $request->user()->id,
                'status' => 'Pending',
            ]);

            $vehicle->update([
                'condition' => 'Needs Inspection',
            ]);

            $this->history($vehicle, 'Issue Reported', "{$data['issue_type']} was reported for {$vehicle->vehicle_name}.", 'vehicle_issue_reports', $issue->issue_report_id, $request);
            $this->log($request, 'Add', 'Vehicle Issue Reports', $issue->issue_report_id, "Reported {$data['issue_type']} for {$vehicle->vehicle_name}");

            return $issue;
        });

        return response()->json($issue->load(['vehicle.category', 'reportedBy']), 201);
    }

    public function updateIssue(Request $request, VehicleIssueReport $issue)
    {
        $this->requireRole($request, ['Admin', 'Maintenance Personnel', 'Custodian']);

        if ($request->user()->role === 'Custodian') {
            abort_unless($issue->reported_by === $request->user()->id, 403, 'You can only edit your own issue reports.');
            abort_unless($issue->status === 'Pending', 422, 'This issue has already been reviewed and can no longer be edited.');

            $data = $request->validate([
                'issue_type' => ['sometimes', Rule::in($this->issueTypes)],
                'issue_description' => ['sometimes', 'string'],
                'severity_level' => ['sometimes', Rule::in(['Low', 'Medium', 'High', 'Critical'])],
                'photo' => ['nullable', 'image', 'max:4096'],
                'remarks' => ['nullable', 'string'],
            ]);

            if ($request->hasFile('photo')) {
                $data['photo_url'] = $this->storeUploadedImage($request->file('photo'), 'issue-attachments');
            }
            unset($data['photo']);

            $issue->update($data);
            $this->log($request, 'Edit', 'Vehicle Issue Reports', $issue->issue_report_id, "Updated issue report #{$issue->issue_report_id}");

            return $issue->fresh(['vehicle.category', 'reportedBy']);
        }

        $data = $request->validate([
            'status' => ['sometimes', Rule::in(['Pending', 'Under Review', 'In Maintenance', 'Resolved'])],
            'remarks' => ['nullable', 'string'],
            'issue_type' => ['sometimes', Rule::in($this->issueTypes)],
            'issue_description' => ['sometimes', 'string'],
            'severity_level' => ['sometimes', Rule::in(['Low', 'Medium', 'High', 'Critical'])],
        ]);

        DB::transaction(function () use ($issue, $data, $request) {
            $issue->update($data);

            if (isset($data['status'])) {
                $status = $data['status'];
                $vehicleUpdates = [];

                if ($status === 'In Maintenance') {
                    $vehicleUpdates['status'] = 'Under Maintenance';
                    $vehicleUpdates['condition'] = 'Needs Repair';
                } elseif ($status === 'Resolved') {
                    $vehicleUpdates['status'] = 'Available';
                    $vehicleUpdates['condition'] = 'Good';
                } elseif ($status === 'Pending' || $status === 'Under Review') {
                    $vehicleUpdates['status'] = 'Available';
                    $vehicleUpdates['condition'] = 'Needs Inspection';
                }

                if (!empty($vehicleUpdates)) {
                    $issue->vehicle->update($vehicleUpdates);
                }
            }

            $this->history($issue->vehicle, 'Issue Updated', "Issue #{$issue->issue_report_id} was updated to {$issue->status}.", 'vehicle_issue_reports', $issue->issue_report_id, $request);
            $this->log($request, 'Edit', 'Vehicle Issue Reports', $issue->issue_report_id, "Updated issue #{$issue->issue_report_id}");
        });

        return $issue->fresh(['vehicle.category', 'reportedBy']);
    }

    public function destroyIssue(Request $request, VehicleIssueReport $issue)
    {
        $user = $request->user();

        if ($user->role === 'Custodian') {
            abort_unless($issue->reported_by === $user->id, 403, 'You can only delete your own issue reports.');
            abort_unless($issue->status === 'Pending', 422, 'This issue has already been reviewed and can no longer be deleted.');
        } else {
            $this->requireRole($request, ['Admin']);
        }

        $this->log($request, 'Delete', 'Vehicle Issue Reports', $issue->issue_report_id, "Deleted issue report #{$issue->issue_report_id}");
        $issue->delete();

        return response()->json(['message' => 'Issue report deleted.']);
    }

    public function maintenanceRecords(Request $request)
    {
        $query = VehicleMaintenanceRecord::with([
            'vehicle.category',
            'issueReport',
            'maintenancePersonnel',
            'verifiedBy',
            'confirmedBy',
        ]);

        if ($request->boolean('mine')) {
            $query->where('maintenance_personnel_id', $request->user()->id);
        }

        if ($request->boolean('history')) {
            $query->where('progress_status', 'Completed');
        }

        if ($request->boolean('for_verification')) {
            $query->where('progress_status', 'For Verification');
        }

        $query->when($request->filled('progress_status'), fn ($q) => $q->where('progress_status', $request->progress_status))
            ->when($request->filled('maintenance_type'), fn ($q) => $q->where('maintenance_type', $request->maintenance_type));

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(function ($nested) use ($search) {
                $nested->where('maintenance_type', 'like', "%{$search}%")
                    ->orWhere('problem_reason', 'like', "%{$search}%")
                    ->orWhereHas('vehicle', function ($vehicleQuery) use ($search) {
                        $vehicleQuery->where('vehicle_name', 'like', "%{$search}%")
                            ->orWhere('plate_number', 'like', "%{$search}%");
                    });
            });
        }

        return $query->latest('maintenance_id')->get();
    }

    public function storeMaintenanceRecord(Request $request)
    {
        $this->requireRole($request, ['Admin', 'Maintenance Personnel']);

        $data = $request->validate([
            'vehicle_id' => ['required', 'exists:vehicles,vehicle_id'],
            'issue_report_id' => ['nullable', 'exists:vehicle_issue_reports,issue_report_id'],
            'maintenance_type' => ['required', Rule::in($this->maintenanceTypes)],
            'problem_reason' => ['required', 'string'],
            'date_started' => ['nullable', 'date'],
            'date_completed' => ['nullable', 'date'],
            'maintenance_personnel_id' => ['nullable', 'exists:users,id'],
            'action_taken' => ['nullable', 'string'],
            'parts_used' => ['nullable', 'string'],
            'progress_status' => ['nullable', Rule::in(['Assigned', 'Under Repair', 'For Verification', 'Completed'])],
            'remarks' => ['nullable', 'string'],
        ]);

        if ($request->user()->role === 'Maintenance Personnel') {
            $data['maintenance_personnel_id'] = $request->user()->id;
        }

        abort_if(empty($data['maintenance_personnel_id']), 422, 'Please select maintenance personnel.');

        $record = DB::transaction(function () use ($data, $request) {
            $vehicle = Vehicle::findOrFail($data['vehicle_id']);
            $record = VehicleMaintenanceRecord::create($data + [
                'progress_status' => $data['progress_status'] ?? 'Assigned',
            ]);

            $vehicle->update([
                'status' => 'Under Maintenance',
                'condition' => 'Needs Repair',
            ]);

            if (! empty($data['issue_report_id'])) {
                VehicleIssueReport::where('issue_report_id', $data['issue_report_id'])->update([
                    'status' => 'In Maintenance',
                ]);
            }

            $this->history($vehicle, 'Maintenance Recorded', "{$data['maintenance_type']} was recorded for {$vehicle->vehicle_name}.", 'vehicle_maintenance_records', $record->maintenance_id, $request);
            $this->log($request, 'Add', 'Vehicle Maintenance Records', $record->maintenance_id, "Added maintenance record for {$vehicle->vehicle_name}");

            return $record;
        });

        return response()->json($record->load(['vehicle.category', 'issueReport', 'maintenancePersonnel']), 201);
    }

    public function updateMaintenanceRecord(Request $request, VehicleMaintenanceRecord $record)
    {
        $this->requireRole($request, ['Admin', 'Maintenance Personnel']);

        $data = $request->validate([
            'issue_report_id' => ['nullable', 'exists:vehicle_issue_reports,issue_report_id'],
            'maintenance_type' => ['sometimes', Rule::in($this->maintenanceTypes)],
            'problem_reason' => ['sometimes', 'string'],
            'date_started' => ['nullable', 'date'],
            'date_completed' => ['nullable', 'date'],
            'maintenance_personnel_id' => ['nullable', 'exists:users,id'],
            'action_taken' => ['nullable', 'string'],
            'parts_used' => ['nullable', 'string'],
            'progress_status' => ['nullable', Rule::in(['Assigned', 'Under Repair', 'For Verification', 'Completed'])],
            'remarks' => ['nullable', 'string'],
        ]);

        if (($data['progress_status'] ?? null) === 'Completed' && $request->user()->role === 'Maintenance Personnel') {
            $data['progress_status'] = 'For Verification';
            $data['date_completed'] = null;
            $data['verification_result'] = null;
            $data['verification_notes'] = null;
            $data['verified_by'] = null;
            $data['verified_at'] = null;
        }

        if (($data['progress_status'] ?? null) === 'Completed') {
            abort_unless(
                $request->user()->role === 'Admin' && $record->verification_result === 'Passed',
                422,
                'A maintenance record can only be completed by an Admin after Custodian verification has passed. Use the verify/confirm workflow instead.'
            );
        }

        $record->update($data);

        if ($record->issue_report_id) {
            $record->issueReport()->update([
                'status' => $record->progress_status === 'Completed' ? 'Resolved' : 'In Maintenance',
            ]);
        }

        $this->history($record->vehicle, 'Maintenance Updated', "Maintenance #{$record->maintenance_id} was updated to {$record->progress_status}.", 'vehicle_maintenance_records', $record->maintenance_id, $request);
        $this->log($request, 'Edit', 'Vehicle Maintenance Records', $record->maintenance_id, "Updated maintenance #{$record->maintenance_id}");

        return $record->fresh(['vehicle.category', 'issueReport', 'maintenancePersonnel', 'verifiedBy', 'confirmedBy']);
    }

    public function verifyMaintenance(Request $request, VehicleMaintenanceRecord $record)
    {
        $this->requireRole($request, ['Custodian']);

        abort_unless(
            $record->progress_status === 'For Verification',
            422,
            'This maintenance record is not awaiting verification.'
        );

        $data = $request->validate([
            'verification_result' => ['required', Rule::in(['Passed', 'Failed'])],
            'verification_notes' => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($record, $data, $request) {
            $passed = $data['verification_result'] === 'Passed';

            $record->update([
                'progress_status' => $passed ? 'For Verification' : 'Under Repair',
                'verification_result' => $data['verification_result'],
                'verification_notes' => $data['verification_notes'] ?? null,
                'verified_by' => $request->user()->id,
                'verified_at' => now(),
            ]);

            if ($record->issueReport) {
                $record->issueReport->update([
                    'status' => $passed ? 'In Maintenance' : 'Under Review',
                ]);
            }

            $record->vehicle->update([
                'status' => 'Under Maintenance',
                'condition' => $passed ? 'Needs Inspection' : 'Needs Repair',
            ]);

            $activity = $passed ? 'Repair Verification Passed' : 'Repair Verification Failed';
            $this->history($record->vehicle, $activity, "Custodian marked maintenance #{$record->maintenance_id} as {$data['verification_result']}.", 'vehicle_maintenance_records', $record->maintenance_id, $request);
            $this->log($request, 'Edit', 'Vehicle Maintenance Records', $record->maintenance_id, "{$activity} for maintenance #{$record->maintenance_id}");
        });

        return $record->fresh(['vehicle.category', 'issueReport', 'maintenancePersonnel', 'verifiedBy', 'confirmedBy']);
    }

    public function confirmMaintenance(Request $request, VehicleMaintenanceRecord $record)
    {
        $this->requireRole($request, ['Admin']);

        abort_unless(
            $record->progress_status === 'For Verification' && $record->verification_result === 'Passed',
            422,
            'This maintenance record has not passed Custodian verification yet.'
        );

        $data = $request->validate([
            'confirmed' => ['required', 'boolean'],
            'remarks' => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($record, $data, $request) {
            if ($data['confirmed']) {
                $record->update([
                    'progress_status' => 'Completed',
                    'date_completed' => $record->date_completed ?? now()->toDateString(),
                    'confirmed_by' => $request->user()->id,
                    'confirmed_at' => now(),
                    'remarks' => $data['remarks'] ?? $record->remarks,
                ]);

                $record->vehicle->update([
                    'status' => 'Available',
                    'condition' => 'Good',
                ]);

                if ($record->issueReport) {
                    $record->issueReport->update(['status' => 'Resolved']);
                }

                $this->history($record->vehicle, 'Ticket Closed', "Maintenance #{$record->maintenance_id} was confirmed and closed.", 'vehicle_maintenance_records', $record->maintenance_id, $request);
                $this->log($request, 'Edit', 'Vehicle Maintenance Records', $record->maintenance_id, "Confirmed maintenance #{$record->maintenance_id}");

                return;
            }

            $record->update([
                'progress_status' => 'Under Repair',
                'remarks' => $data['remarks'] ?? $record->remarks,
            ]);

            $record->vehicle->update([
                'status' => 'Under Maintenance',
                'condition' => 'Needs Repair',
            ]);

            if ($record->issueReport) {
                $record->issueReport->update(['status' => 'Under Review']);
            }

            $this->history($record->vehicle, 'Ticket Reopened', "Maintenance #{$record->maintenance_id} was reopened for more work.", 'vehicle_maintenance_records', $record->maintenance_id, $request);
            $this->log($request, 'Edit', 'Vehicle Maintenance Records', $record->maintenance_id, "Reopened maintenance #{$record->maintenance_id}");
        });

        return $record->fresh(['vehicle.category', 'issueReport', 'maintenancePersonnel', 'verifiedBy', 'confirmedBy']);
    }

    public function schedules(Request $request)
    {
        $query = VehicleMaintenanceSchedule::with(['vehicle.category', 'createdBy', 'assignedTo']);

        $query->when($request->filled('status'), fn ($q) => $q->where('status', $request->status))
            ->when($request->filled('maintenance_type'), fn ($q) => $q->where('maintenance_type', $request->maintenance_type));

        if ($request->filled('from')) {
            $query->whereDate('scheduled_date', '>=', $request->from);
        }

        if ($request->filled('to')) {
            $query->whereDate('scheduled_date', '<=', $request->to);
        }

        return $query->orderBy('scheduled_date')->orderBy('scheduled_time')->get();
    }

    public function storeSchedule(Request $request)
    {
        $this->requireRole($request, ['Admin', 'Maintenance Personnel']);

        $data = $request->validate([
            'vehicle_id' => ['required', 'exists:vehicles,vehicle_id'],
            'maintenance_type' => ['required', Rule::in($this->maintenanceTypes)],
            'scheduled_date' => ['required', 'date'],
            'scheduled_time' => ['nullable', 'date_format:H:i'],
            'service_location' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
            'assigned_to' => ['nullable', 'exists:users,id'],
            'status' => ['nullable', Rule::in(['Scheduled', 'Completed', 'Cancelled'])],
        ]);

        $schedule = DB::transaction(function () use ($data, $request) {
            $vehicle = Vehicle::findOrFail($data['vehicle_id']);
            $schedule = VehicleMaintenanceSchedule::create($data + [
                'created_by' => $request->user()->id,
                'status' => $data['status'] ?? 'Scheduled',
            ]);

            $this->history($vehicle, 'Maintenance Scheduled', "{$data['maintenance_type']} was scheduled for {$vehicle->vehicle_name}.", 'vehicle_maintenance_schedules', $schedule->schedule_id, $request);
            $this->log($request, 'Add', 'Vehicle Maintenance Schedule', $schedule->schedule_id, "Scheduled maintenance for {$vehicle->vehicle_name}");

            return $schedule;
        });

        return response()->json($schedule->load(['vehicle.category', 'createdBy', 'assignedTo']), 201);
    }

    public function updateSchedule(Request $request, VehicleMaintenanceSchedule $schedule)
    {
        $this->requireRole($request, ['Admin', 'Maintenance Personnel']);

        $data = $request->validate([
            'vehicle_id' => ['sometimes', 'exists:vehicles,vehicle_id'],
            'maintenance_type' => ['sometimes', Rule::in($this->maintenanceTypes)],
            'scheduled_date' => ['sometimes', 'date'],
            'scheduled_time' => ['nullable', 'date_format:H:i'],
            'service_location' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
            'assigned_to' => ['nullable', 'exists:users,id'],
            'status' => ['nullable', Rule::in(['Scheduled', 'Completed', 'Cancelled'])],
        ]);

        $schedule->update($data);
        $this->history($schedule->vehicle, 'Maintenance Schedule Updated', "Maintenance schedule #{$schedule->schedule_id} was updated.", 'vehicle_maintenance_schedules', $schedule->schedule_id, $request);
        $this->log($request, 'Edit', 'Vehicle Maintenance Schedule', $schedule->schedule_id, "Updated schedule #{$schedule->schedule_id}");

        return $schedule->fresh(['vehicle.category', 'createdBy', 'assignedTo']);
    }

    public function deleteSchedule(Request $request, VehicleMaintenanceSchedule $schedule)
    {
        $this->requireRole($request, ['Admin', 'Maintenance Personnel']);

        $schedule->update(['status' => 'Cancelled']);
        $this->history($schedule->vehicle, 'Maintenance Schedule Cancelled', "Maintenance schedule #{$schedule->schedule_id} was cancelled.", 'vehicle_maintenance_schedules', $schedule->schedule_id, $request);
        $this->log($request, 'Delete', 'Vehicle Maintenance Schedule', $schedule->schedule_id, "Cancelled schedule #{$schedule->schedule_id}");

        return response()->json(['message' => 'Maintenance schedule cancelled.']);
    }

    public function histories(Request $request)
    {
        $this->requireRole($request, ['Admin']);

        $query = VehicleHistory::with(['vehicle.category', 'updatedBy']);

        $query->when($request->filled('vehicle_id'), fn ($q) => $q->where('vehicle_id', $request->vehicle_id))
            ->when($request->filled('activity_type'), fn ($q) => $q->where('activity_type', $request->activity_type));

        return $query->latest('history_id')->get();
    }

    public function logs(Request $request)
    {
        $this->requireRole($request, ['Admin']);

        $query = ActivityLog::with('user');

        $query->when($request->filled('module'), fn ($q) => $q->where('module', $request->module))
            ->when($request->filled('action'), fn ($q) => $q->where('action', $request->action));

        if ($request->filled('q')) {
            $search = $request->string('q');
            $query->where(function ($nested) use ($search) {
                $nested->where('details', 'like', "%{$search}%")
                    ->orWhere('module', 'like', "%{$search}%")
                    ->orWhereHas('user', fn ($userQuery) => $userQuery->where('name', 'like', "%{$search}%"));
            });
        }

        return $query->latest('log_id')->get();
    }

    public function reports(Request $request)
    {
        $this->requireRole($request, ['Admin']);

        $data = $request->validate([
            'report_type' => ['required', 'string'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'category_id' => ['nullable', 'exists:vehicle_categories,category_id'],
            'location' => ['nullable', 'string'],
            'maintenance_type' => ['nullable', 'string'],
            'issue_type' => ['nullable', 'string'],
            'severity_level' => ['nullable', 'string'],
        ]);

        $rows = match ($data['report_type']) {
            'Vehicle Type Report' => Vehicle::query()
                ->with('category')
                ->when($request->filled('category_id'), fn ($q) => $q->where('category_id', $data['category_id']))
                ->get(),
            'Vehicle Location Report' => Vehicle::query()
                ->with('category')
                ->when($request->filled('location'), fn ($q) => $q->where('current_location', $data['location']))
                ->get(),
            'Vehicle Issue Report' => VehicleIssueReport::query()
                ->with(['vehicle.category', 'reportedBy'])
                ->when($request->filled('issue_type'), fn ($q) => $q->where('issue_type', $data['issue_type']))
                ->when($request->filled('severity_level'), fn ($q) => $q->where('severity_level', $data['severity_level']))
                ->when($request->filled('from'), fn ($q) => $q->whereDate('created_at', '>=', $data['from']))
                ->when($request->filled('to'), fn ($q) => $q->whereDate('created_at', '<=', $data['to']))
                ->get(),
            'Vehicle Maintenance Report' => VehicleMaintenanceRecord::query()
                ->with(['vehicle.category', 'maintenancePersonnel'])
                ->when($request->filled('maintenance_type'), fn ($q) => $q->where('maintenance_type', $data['maintenance_type']))
                ->when($request->filled('from'), fn ($q) => $q->whereDate('created_at', '>=', $data['from']))
                ->when($request->filled('to'), fn ($q) => $q->whereDate('created_at', '<=', $data['to']))
                ->get(),
            'Vehicle Maintenance Schedule Report' => VehicleMaintenanceSchedule::query()
                ->with(['vehicle.category', 'createdBy', 'assignedTo'])
                ->when($request->filled('from'), fn ($q) => $q->whereDate('scheduled_date', '>=', $data['from']))
                ->when($request->filled('to'), fn ($q) => $q->whereDate('scheduled_date', '<=', $data['to']))
                ->get(),
            'Vehicle History Report' => VehicleHistory::with(['vehicle.category', 'updatedBy'])->latest('history_id')->get(),
            default => Vehicle::with('category')->get(),
        };

        $this->log($request, 'Generate Report', 'Reports', null, "Generated {$data['report_type']}");

        return response()->json([
            'report_type' => $data['report_type'],
            'generated_by' => $request->user()->name,
            'generated_at' => now(),
            'rows' => $rows,
        ]);
    }

    private function validateVehicle(Request $request, ?Vehicle $vehicle = null): array
    {
        $domain = VehicleCategory::find($request->input('category_id'))?->domain ?? 'Land';

        return $request->validate([
            'vehicle_name' => ['required', 'string', 'max:255'],
            'plate_number' => [
                'required',
                'string',
                'max:255',
                Rule::unique('vehicles', 'plate_number')->ignore($vehicle?->vehicle_id, 'vehicle_id'),
            ],
            'category_id' => ['required', 'exists:vehicle_categories,category_id'],
            'brand' => ['required', 'string', 'max:255'],
            'model' => ['required', 'string', 'max:255'],
            'year_model' => ['required', new NumberOnly, 'integer', 'min:1900', 'max:' . now()->addYear()->year],
            'capacity' => ['required', 'string', 'max:255'],
            'fuel_type' => [$domain === 'Land' ? 'required' : 'nullable', 'string', 'max:255'],
            'hull_material' => [$domain === 'Water' ? 'required' : 'nullable', 'string', 'max:255'],
            'engine_type' => [$domain === 'Water' ? 'required' : 'nullable', 'string', 'max:255'],
            'vehicle_color' => ['required', 'string', 'max:255', new TextOnly],
            'current_location' => ['required', 'string', 'max:255', Rule::in(VehicleHub::pluck('name'))],
            'photo' => ['nullable', 'image', 'max:4096'],
            'remarks' => ['nullable', 'string'],
        ]);
    }

    private function storeVehiclePhoto($file): string
    {
        return $this->storeUploadedImage($file, 'vehicles');
    }

    private function history(Vehicle $vehicle, string $activityType, string $description, string $relatedTable, int|string $relatedRecordId, Request $request): void
    {
        VehicleHistory::create([
            'vehicle_id' => $vehicle->vehicle_id,
            'activity_type' => $activityType,
            'description' => $description,
            'related_table' => $relatedTable,
            'related_record_id' => (string) $relatedRecordId,
            'updated_by' => $request->user()?->id,
        ]);
    }

    private function log(Request $request, string $action, string $module, int|string|null $affectedRecordId, ?string $details): void
    {
        ActivityLog::create([
            'user_id' => $request->user()?->id,
            'role' => $request->user()?->role,
            'action' => $action,
            'module' => $module,
            'affected_record_id' => $affectedRecordId ? (string) $affectedRecordId : null,
            'details' => $details,
        ]);
    }

    private function requireRole(Request $request, array $roles): void
    {
        abort_unless(in_array($request->user()->role, $roles, true), 403, 'Your account role cannot perform this action.');
    }

    private function syncVehicleStatuses()
    {
        $vehicles = Vehicle::where('status', '!=', 'Inactive')->get();
        foreach ($vehicles as $vehicle) {
            $activeTicket = \App\Models\MaintenanceTicket::where('vehicle_id', $vehicle->vehicle_id)
                ->whereNotIn('status', ['Done', 'Cancelled'])
                ->first();
            $hasActiveTicketMaintenance = $activeTicket && in_array($activeTicket->status, ['For Maintenance', 'Under Repair', 'For Inspection', 'For Confirmation'], true);

            $hasActiveMaintenance = VehicleMaintenanceRecord::where('vehicle_id', $vehicle->vehicle_id)
                ->whereNotIn('progress_status', ['Completed'])
                ->exists() || $hasActiveTicketMaintenance;

            $latestIssue = VehicleIssueReport::where('vehicle_id', $vehicle->vehicle_id)
                ->orderByDesc('issue_report_id')
                ->first();

            if ($latestIssue) {
                if ($latestIssue->status === 'In Maintenance') {
                    if ($vehicle->status !== 'Under Maintenance' || $vehicle->condition !== 'Needs Repair') {
                        $vehicle->update([
                            'status' => 'Under Maintenance',
                            'condition' => 'Needs Repair',
                        ]);
                    }
                } elseif (in_array($latestIssue->status, ['Pending', 'Under Review'], true)) {
                    if (!$hasActiveMaintenance) {
                        if ($vehicle->status === 'Under Maintenance' || $vehicle->condition !== 'Needs Inspection') {
                            $vehicle->update([
                                'status' => 'Available',
                                'condition' => 'Needs Inspection',
                            ]);
                        }
                    }
                } elseif ($latestIssue->status === 'Resolved') {
                    $hasOtherActiveIssues = VehicleIssueReport::where('vehicle_id', $vehicle->vehicle_id)
                        ->whereNot('status', 'Resolved')
                        ->exists();

                    if (!$hasOtherActiveIssues && !$hasActiveMaintenance) {
                        if ($vehicle->status === 'Under Maintenance' || $vehicle->condition !== 'Good') {
                            $vehicle->update([
                                'status' => 'Available',
                                'condition' => 'Good',
                            ]);
                        }
                    }
                }
            }
        }
    }
}
