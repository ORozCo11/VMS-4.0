<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VehicleMaintenanceRecord extends Model
{
    protected $primaryKey = 'maintenance_id';

    protected $fillable = [
        'vehicle_id',
        'issue_report_id',
        'maintenance_type',
        'problem_reason',
        'date_started',
        'date_completed',
        'maintenance_personnel_id',
        'action_taken',
        'parts_used',
        'maintenance_cost',
        'progress_status',
        'remarks',
        'verification_result',
        'verification_notes',
        'verified_by',
        'verified_at',
        'confirmed_by',
        'confirmed_at',
    ];

    protected $casts = [
        'verified_at' => 'datetime',
        'confirmed_at' => 'datetime',
    ];

    public function vehicle()
    {
        return $this->belongsTo(Vehicle::class, 'vehicle_id', 'vehicle_id');
    }

    public function issueReport()
    {
        return $this->belongsTo(VehicleIssueReport::class, 'issue_report_id', 'issue_report_id');
    }

    public function maintenancePersonnel()
    {
        return $this->belongsTo(User::class, 'maintenance_personnel_id');
    }

    public function verifiedBy()
    {
        return $this->belongsTo(User::class, 'verified_by');
    }

    public function confirmedBy()
    {
        return $this->belongsTo(User::class, 'confirmed_by');
    }
}
