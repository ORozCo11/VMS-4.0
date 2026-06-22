<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VehicleIssueReport extends Model
{
    protected $primaryKey = 'issue_report_id';

    protected $fillable = [
        'vehicle_id',
        'issue_type',
        'issue_description',
        'severity_level',
        'photo_url',
        'reported_by',
        'status',
        'remarks',
    ];

    public function vehicle()
    {
        return $this->belongsTo(Vehicle::class, 'vehicle_id', 'vehicle_id');
    }

    public function reportedBy()
    {
        return $this->belongsTo(User::class, 'reported_by');
    }

    public function maintenanceRecords()
    {
        return $this->hasMany(VehicleMaintenanceRecord::class, 'issue_report_id', 'issue_report_id');
    }

    public function maintenanceTicket()
    {
        return $this->hasOne(MaintenanceTicket::class, 'issue_report_id', 'issue_report_id');
    }
}
